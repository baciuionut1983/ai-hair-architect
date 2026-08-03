'use client';

import { useState } from 'react';

interface ImageAsset {
  id: string;
  fileName: string;
  uploadedAt: string;
}

interface ImageAnalysis {
  status: string;
  analysisPayload: Record<string, string | null>;
  confidences: Record<string, number>;
  warnings: string[];
  limitations: string[];
}

interface Review {
  [key: string]: string;
}

export default function Milestone9Page() {
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, ImageAnalysis>>({});
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [requestingAi, setRequestingAi] = useState(false);
  const [m8Draft, setM8Draft] = useState<Record<string, unknown> | null>(null);
  const [review, setReview] = useState<Review>({});
  const [error, setError] = useState('');

  const clientId = 'client-1';
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || !files.length) return;

    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('clientId', clientId);
      Array.from(files).forEach(f => formData.append('files', f));

      const res = await fetch('/api/v1/uploads', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json() as Record<string, unknown>;
        throw new Error(String(data.error) || 'Upload failed');
      }

      const data = await res.json() as {
        assets: Array<{ assetId: string; fileName: string }>;
      };
      const newAssets = data.assets.map(a => ({
        id: a.assetId,
        fileName: a.fileName,
        uploadedAt: new Date().toISOString(),
      }));

      setAssets([...assets, ...newAssets]);
      setSelectedAssetId(newAssets[0]?.id || '');

      for (const asset of newAssets) {
        const analysisRes = await fetch(`/api/v1/image-analyses/${asset.id}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (analysisRes.ok) {
          const analysisData = await analysisRes.json() as {
            analyses: ImageAnalysis[];
          };
          setAnalyses(prev => ({
            ...prev,
            [asset.id]: analysisData.analyses[0] || {},
          }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUploading(false);
    }
  };

  const handleReview = async () => {
    if (!selectedAssetId) return;

    setReviewing(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/image-analyses/${selectedAssetId}/review`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          corrections: review,
          finalizeToM8: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as Record<string, unknown>;
        throw new Error(String(data.error) || 'Review failed');
      }

      const data = await res.json() as {
        analysis: { m8Draft: Record<string, unknown> };
      };
      setM8Draft(data.analysis.m8Draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setReviewing(false);
    }
  };

  const handleRequestAiAnalysis = async () => {
    if (!selectedAssetId) return;

    setRequestingAi(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/image-analyses/${selectedAssetId}/request-ai-analysis`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ consent: aiConsent }),
      });

      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(String(data.error) || 'AI analysis request failed');
      }

      setAnalyses(prev => ({
        ...prev,
        [selectedAssetId]: data.analysis as ImageAnalysis,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRequestingAi(false);
    }
  };

  const selectedAnalysis = selectedAssetId ? analyses[selectedAssetId] : null;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Milestone 9 - Image Analysis Review</h1>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Upload Section */}
          <div className="bg-white p-6 rounded shadow">
            <h2 className="text-xl font-semibold mb-4">Upload Images</h2>
            <div className="border-2 border-dashed border-gray-300 rounded p-6 text-center">
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={e => handleFileUpload(e.target.files)}
                disabled={uploading}
                className="block w-full mb-4"
              />
              <p className="text-sm text-gray-600">
                Max 4 images, 8MB each, 24MB total
              </p>
              {uploading && <p className="text-blue-600 mt-2">Uploading...</p>}
            </div>

            {/* Assets List */}
            <div className="mt-6">
              <h3 className="font-semibold mb-3">Uploaded Assets</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {assets.map(asset => (
                  <button
                    key={asset.id}
                    onClick={() => setSelectedAssetId(asset.id)}
                    className={`w-full p-3 text-left rounded border ${
                      selectedAssetId === asset.id
                        ? 'bg-blue-100 border-blue-400'
                        : 'bg-gray-50 border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    <div className="font-mono text-sm break-all">{asset.fileName}</div>
                    <div className="text-xs text-gray-600">
                      {new Date(asset.uploadedAt).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Review Section */}
          {selectedAnalysis && (
            <div className="bg-white p-6 rounded shadow">
              <h2 className="text-xl font-semibold mb-4">Analysis & Review</h2>

              {/* Analysis Status */}
              <div className="mb-4">
                <span className={`px-3 py-1 rounded text-sm font-semibold ${
                  selectedAnalysis.status === 'draft'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-green-100 text-green-800'
                }`}>
                  {selectedAnalysis.status?.toUpperCase()}
                </span>
              </div>

              {/* Real AI Analysis (opt-in) */}
              <div className="mb-4 bg-gray-50 border border-gray-200 rounded p-3">
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={aiConsent}
                    onChange={e => setAiConsent(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    I consent to sending this photo to an external AI provider (Gemini) for analysis.
                  </span>
                </label>
                <button
                  onClick={handleRequestAiAnalysis}
                  disabled={!aiConsent || requestingAi}
                  className="w-full mt-3 bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:bg-gray-400"
                >
                  {requestingAi ? 'Analyzing with AI...' : 'Analyze with Real AI'}
                </button>
              </div>

              {/* Fields with Confidence */}
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {Object.entries(selectedAnalysis.analysisPayload || {}).map(
                  ([field, value]) => {
                    const confidence = selectedAnalysis.confidences?.[field] || 0;
                    const isUnknown = value === 'unknown' || value === null;

                    return (
                      <div key={field} className="border rounded p-3">
                        <div className="flex justify-between items-start mb-2">
                          <label className="font-semibold capitalize">{field}</label>
                          {isUnknown && (
                            <span className="text-xs bg-gray-200 px-2 py-1 rounded">
                              UNKNOWN
                            </span>
                          )}
                        </div>

                        <div className="mb-2">
                          <p className="text-sm text-gray-700">
                            {isUnknown ? 'No value detected' : String(value)}
                          </p>
                          <div className="mt-1 bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${
                                confidence >= 0.7
                                  ? 'bg-green-500'
                                  : 'bg-yellow-500'
                              }`}
                              style={{ width: `${confidence * 100}%` }}
                            />
                          </div>
                          <p className="text-xs text-gray-600">
                            Confidence: {(confidence * 100).toFixed(0)}%
                          </p>
                        </div>

                        <input
                          type="text"
                          placeholder="Correct value (optional)"
                          value={review[field] || ''}
                          onChange={e =>
                            setReview(prev => ({ ...prev, [field]: e.target.value }))
                          }
                          className="w-full px-2 py-1 border rounded text-sm"
                        />
                      </div>
                    );
                  }
                )}
              </div>

              {/* Warnings */}
              {selectedAnalysis.warnings?.length > 0 && (
                <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded p-3">
                  <h4 className="font-semibold text-sm mb-2">Warnings</h4>
                  <ul className="text-sm text-gray-700 list-disc pl-5">
                    {selectedAnalysis.warnings.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Limitations */}
              {selectedAnalysis.limitations?.length > 0 && (
                <div className="mt-4 bg-blue-50 border border-blue-200 rounded p-3">
                  <h4 className="font-semibold text-sm mb-2">Limitations</h4>
                  <ul className="text-sm text-gray-700 list-disc pl-5">
                    {selectedAnalysis.limitations.map((l: string, i: number) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Action Button */}
              <button
                onClick={handleReview}
                disabled={reviewing}
                className="w-full mt-6 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
              >
                {reviewing ? 'Processing...' : 'Confirm Review & Finalize M8'}
              </button>
            </div>
          )}
        </div>

        {/* M8 Draft Display */}
        {m8Draft && (
          <div className="mt-8 bg-white p-6 rounded shadow">
            <h2 className="text-xl font-semibold mb-4">M8 Draft Generated</h2>
            <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
              {JSON.stringify(m8Draft, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

