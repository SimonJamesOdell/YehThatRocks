"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PermissionUser = {
  id: number;
  email: string | null;
  screenName: string | null;
  isSuperAdmin: boolean;
  permissions: string[];
  hasAdminPanelAccess: boolean;
};

type PermissionSearchResponse = {
  ok: boolean;
  users: PermissionUser[];
  availablePermissions: string[];
};

type PermissionUserResponse = {
  ok: boolean;
  user: {
    id: number;
    email: string | null;
    screenName: string | null;
    isSuperAdmin: boolean;
  };
  userId: number;
  permissions: string[];
  hasAdminPanelAccess: boolean;
  availablePermissions?: string[];
};

export function AdminDashboardPermissionsTab({
  onMessage,
}: {
  onMessage: (message: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<PermissionUser[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<string[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedUser, setSelectedUser] = useState<PermissionUser | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingSelectedUser, setLoadingSelectedUser] = useState(false);
  const [savingPermissionKey, setSavingPermissionKey] = useState<string | null>(null);

  const fetchUsers = useCallback(async (searchValue: string) => {
    setLoadingUsers(true);

    try {
      const suffix = searchValue.trim().length > 0
        ? `?q=${encodeURIComponent(searchValue.trim())}`
        : "";
      const response = await fetch(`/api/admin/permissions${suffix}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Could not load users for permission management.");
      }

      const payload = (await response.json()) as PermissionSearchResponse;
      setUsers(payload.users ?? []);
      if ((payload.availablePermissions ?? []).length > 0) {
        setAvailablePermissions(payload.availablePermissions);
      }
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not load users for permission management.");
    } finally {
      setLoadingUsers(false);
    }
  }, [onMessage]);

  const fetchUserPermissions = useCallback(async (userId: number) => {
    setLoadingSelectedUser(true);

    try {
      const response = await fetch(`/api/admin/permissions?userId=${encodeURIComponent(String(userId))}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Could not load selected user permissions.");
      }

      const payload = (await response.json()) as PermissionUserResponse;
      const nextUser: PermissionUser = {
        id: payload.user.id,
        email: payload.user.email,
        screenName: payload.user.screenName,
        isSuperAdmin: payload.user.isSuperAdmin,
        permissions: payload.permissions ?? [],
        hasAdminPanelAccess: payload.hasAdminPanelAccess,
      };
      setSelectedUser(nextUser);

      if ((payload.availablePermissions ?? []).length > 0) {
        setAvailablePermissions(payload.availablePermissions ?? []);
      }

      setUsers((previous) => previous.map((user) => user.id === nextUser.id ? nextUser : user));
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not load selected user permissions.");
    } finally {
      setLoadingSelectedUser(false);
    }
  }, [onMessage]);

  useEffect(() => {
    void fetchUsers("");
  }, [fetchUsers]);

  useEffect(() => {
    if (selectedUserId === null) {
      setSelectedUser(null);
      return;
    }

    void fetchUserPermissions(selectedUserId);
  }, [fetchUserPermissions, selectedUserId]);

  const selectedPermissionSet = useMemo(() => new Set(selectedUser?.permissions ?? []), [selectedUser]);

  const updatePermission = useCallback(async (permission: string, enabled: boolean) => {
    if (!selectedUser) {
      return;
    }

    setSavingPermissionKey(permission);

    try {
      const response = await fetch("/api/admin/permissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: selectedUser.id,
          permission,
          enabled,
        }),
      });

      if (!response.ok) {
        throw new Error("Could not update user permissions.");
      }

      const payload = (await response.json()) as PermissionUserResponse;
      const nextUser: PermissionUser = {
        id: payload.user.id,
        email: payload.user.email,
        screenName: payload.user.screenName,
        isSuperAdmin: payload.user.isSuperAdmin,
        permissions: payload.permissions ?? [],
        hasAdminPanelAccess: payload.hasAdminPanelAccess,
      };

      setSelectedUser(nextUser);
      setUsers((previous) => previous.map((user) => user.id === nextUser.id ? nextUser : user));
      onMessage(`Updated ${permission} for user #${nextUser.id}.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not update user permissions.");
    } finally {
      setSavingPermissionKey(null);
    }
  }, [onMessage, selectedUser]);

  return (
    <section className="panel featurePanel">
      <div className="panelHeading">
        <span><span className="whiteAccountGlyph" aria-hidden="true">🛡</span> Admin Permissions</span>
        <strong>Super Admin Only</strong>
      </div>

      <div className="interactiveStack adminPermissionsStack">
        <div className="adminPermissionsSearchRow">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find user by id, screen name, or email"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onMessage(null);
                void fetchUsers(query);
              }
            }}
          />
          <button
            type="button"
            className="navLink navLinkActive"
            onClick={() => {
              onMessage(null);
              void fetchUsers(query);
            }}
            disabled={loadingUsers}
          >
            {loadingUsers ? "Searching..." : "Search"}
          </button>
        </div>

        <div className="adminPermissionsLayout">
          <div className="adminPermissionsUsersColumn">
            <div className="adminPermissionsSectionLabel">Users</div>
            {users.length === 0 ? <p className="authMessage">No users found.</p> : (
              <div className="adminPermissionsUserList">
                {users.map((user) => {
                  const selected = user.id === selectedUserId;
                  const displayName = user.screenName?.trim() || user.email || `user-${user.id}`;
                  return (
                    <button
                      key={`admin-user-${user.id}`}
                      type="button"
                      onClick={() => {
                        onMessage(null);
                        setSelectedUserId(user.id);
                      }}
                      className={selected ? "adminPermissionsUserCard adminPermissionsUserCardSelected" : "adminPermissionsUserCard"}
                    >
                      <div className="adminPermissionsUserCardHeader">
                        <strong>{displayName}</strong>
                        {user.isSuperAdmin ? <span className="adminPermissionsSuperBadge">super_admin</span> : null}
                      </div>
                      <div className="adminPermissionsUserMeta">#{user.id} · {user.email ?? "no-email"}</div>
                      {user.hasAdminPanelAccess ? <div className="adminPermissionsAccessHint">Has admin access</div> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="adminPermissionsDetailColumn">
            {!selectedUser ? (
              <p className="authMessage">Select a user to manage permissions.</p>
            ) : loadingSelectedUser ? (
              <p className="authMessage">Loading permissions...</p>
            ) : (
              <div className="adminPermissionsDetailStack">
                <div className="adminPermissionsDetailHeader">
                  <strong>{selectedUser.screenName?.trim() || selectedUser.email || `user-${selectedUser.id}`}</strong>
                  <div className="adminPermissionsUserMeta">#{selectedUser.id} · {selectedUser.email ?? "no-email"}</div>
                  {selectedUser.isSuperAdmin ? (
                    <div className="adminPermissionsSuperHint">
                      This account is super_admin and always has full access.
                    </div>
                  ) : null}
                </div>

                <div className="adminPermissionsToggleList">
                  {availablePermissions.map((permission) => {
                    const checked = selectedPermissionSet.has(permission);
                    const disabled = savingPermissionKey !== null || selectedUser.isSuperAdmin;
                    const isAdminAbilityToggle = permission === "admin.panel.view";

                    return (
                      <label
                        key={`perm-${permission}`}
                        className="adminPermissionsToggleItem"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={(event) => {
                            void updatePermission(permission, event.target.checked);
                          }}
                        />
                        <span className="adminPermissionsPermissionKey">{permission}</span>
                        {isAdminAbilityToggle ? <span className="adminPermissionsAbilityHint">Admin panel access</span> : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
