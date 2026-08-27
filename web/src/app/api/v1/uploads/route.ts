import { NextRequest, NextResponse } from 'next/server';
import { ObjectStorageWriteModeRequiredError, uploadAndAnalyzeImages } from '@/lib/image-analysis-service';
import { ImageProcessingError } from '@/lib/image-normalizer';
import { checkRateLimit, getRateLimitStatus } from '@/lib/rate-limiter';
import { checkRole } from '@/lib/auth-role';
import { resolveOwnedClient } from '@/lib/client-repository';
import { resolvePipelineAuth } from '@/lib/image-pipeline-auth';

export async function POST(req: NextRequest) {
  try {
    const user = await resolvePipelineAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const roleCheck = checkRole(user, ['professional', 'salon', 'admin']);
    if (!roleCheck.allowed) {
      return NextResponse.json(
        { error: 'Forbidden', reason: `Role ${user.role} cannot upload images` },
        { status: 403 }
      );
    }

    const rlCheck = checkRateLimit(user.id, 'UPLOAD');
    if (!rlCheck.allowed) {
      const status = getRateLimitStatus(user.id, 'UPLOAD');
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rlCheck.retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After': String(rlCheck.retryAfter),
            'X-RateLimit-Limit': String(status?.limit),
            'X-RateLimit-Remaining': String(status?.remaining),
            'X-RateLimit-Reset': String(status?.reset),
          },
        }
      );
    }

    const formData = await req.formData();
    const clientId = formData.get('clientId') as string;
    const filesFormData = formData.getAll('files') as File[];

    if (!clientId || !filesFormData.length) {
      return NextResponse.json(
        { error: 'clientId and files required' },
        { status: 400 }
      );
    }

    // The multipart `clientId` is attacker-controlled input. Before a single
    // ImageAsset row is created, confirm it names a client this authenticated
    // user actually owns (matching ownerUserId, not soft-deleted).
    // `resolveOwnedClient` is the same owner-scoped lookup every sibling
    // client-scoped route uses (clients/[id]/formulas, appointments,
    // shortlists); ImageAsset is the one client-scoped model with no
    // database-level composite FK to Client, so this check is the sole thing
    // standing between a forged clientId and a cross-tenant row. A clientId
    // that belongs to a DIFFERENT owner and a clientId that exists nowhere
    // both resolve to null here and return the identical generic 404, so the
    // response never reveals that another owner's client exists. A Response
    // means client persistence is unavailable (fail closed, 503) -- returned
    // as-is, exactly as the sibling routes do.
    const client = await resolveOwnedClient(user.id, clientId);
    if (client instanceof Response) return client;
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    }

    const results = await uploadAndAnalyzeImages(user.id, client.id, filesFormData);

    const status = getRateLimitStatus(user.id, 'UPLOAD');
    return NextResponse.json(
      {
        success: true,
        assets: results.map((r) => ({
          assetId: r.asset.id,
          analysisId: r.analysis.id,
          fileName: r.asset.fileName,
          status: r.analysis.status,
        })),
      },
      {
        headers: {
          'X-RateLimit-Limit': String(status?.limit),
          'X-RateLimit-Remaining': String(status?.remaining),
          'X-RateLimit-Reset': String(status?.reset),
        },
      }
    );
  } catch (err) {
    // Structured, safe-fields-only log for every upload failure (no image
    // bytes, no secrets) -- this is what makes VipsJpeg/S3/Prisma failures
    // diagnosable from Deploy Logs instead of only surfacing in the UI.
    console.error(
      JSON.stringify({
        gate: 'IMAGE_UPLOAD',
        status: 'FAILED',
        errorName: err instanceof Error ? err.name : 'unknown',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    );

    // A missing OBJECT_STORAGE_WRITE_MODE in production is a server
    // configuration problem, never something the caller's request could
    // have avoided -- 503, not 400/422, and never silently accepted.
    if (err instanceof ObjectStorageWriteModeRequiredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }

    // ImageProcessingError (image-normalizer.ts) always carries a safe,
    // generic message already -- the raw sharp/libvips detail was logged
    // above, never returned to the client. Every other Error thrown by
    // uploadAndAnalyzeImages (validation/magic-byte checks) is also a
    // safe, self-constructed message, not raw library/SDK output.
    const error = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json(
      { error },
      { status: err instanceof ImageProcessingError ? 422 : 400 }
    );
  }
}
