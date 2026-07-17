import { describe, expect, it } from "vitest";

import { addWorkspaceMember, createUser, createWorkspace, getWorkspacesForUser } from "./milestone1-store";

describe("milestone6 workspace boundaries", () => {
  it("creates workspace and enforces member-add permissions", () => {
    const owner = createUser({
      email: `m6-owner-${Date.now()}@example.com`,
      password: "password123",
      role: "salon",
      locale: "en"
    });

    const stylist = createUser({
      email: `m6-stylist-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    const outsider = createUser({
      email: `m6-outsider-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    const workspace = createWorkspace(owner.id, "Salon A");

    const added = addWorkspaceMember({
      workspaceId: workspace.id,
      actorUserId: owner.id,
      userId: stylist.id,
      role: "stylist"
    });
    expect(added?.workspaceId).toBe(workspace.id);

    const denied = addWorkspaceMember({
      workspaceId: workspace.id,
      actorUserId: outsider.id,
      userId: stylist.id,
      role: "stylist"
    });
    expect(denied).toBeNull();

    const stylistWorkspaces = getWorkspacesForUser(stylist.id);
    expect(stylistWorkspaces.map((item) => item.id)).toContain(workspace.id);
  });
});
