import { asConceptId, type Permission } from '@content-insights/shared';

import { ForbiddenError } from './errors.js';
import { resolveEffectivePermissions, type EffectivePermissions } from './permissions.js';
import type { ArticleSearchGrants, HardFilterGrantWithKey } from './search.js';
import { ConceptModel } from '../models/concept.model.js';
import { GroupModel } from '../models/group.model.js';
import { ProjectModel } from '../models/project.model.js';
import { RoleModel } from '../models/role.model.js';
import { UserModel } from '../models/user.model.js';
import type { AuthenticatedUser } from '../types/express.js';

// ---------------------------------------------------------------------------
// Low-level effective-permission primitives — deliberately self-contained (only
// lib/permissions.ts + RoleModel) rather than importing lib/group-scope.ts's
// hasGroupPermission/resolveDocumentScope, which pull in models unrelated to Articles.
// Exported so callers that need a tag- or resource-specific authorization check beyond
// plain project/hard-filter scoping (e.g. article.routes.ts's addTags/removeTags, which
// must also respect a UserTag's own sharing grants) can reuse the same resolved
// permission set instead of re-querying Role documents per check.
// ---------------------------------------------------------------------------

export async function resolveUserEffectivePermissions(user: AuthenticatedUser): Promise<EffectivePermissions> {
  const roleIds = Array.from(new Set(user.roleAssignments.map((assignment) => assignment.roleId)));
  const roles = roleIds.length > 0 ? await RoleModel.find({ _id: { $in: roleIds }, orgId: user.orgId }) : [];
  return resolveEffectivePermissions(user, roles);
}

export function hasGlobalPermission(user: AuthenticatedUser, permissionKey: Permission): boolean {
  return user.globalPermissions.includes('*') || user.globalPermissions.includes(permissionKey);
}

export function hasPermissionInGroup(
  effective: EffectivePermissions,
  permissionKey: Permission,
  groupId: string,
): boolean {
  const groupPermissions = effective.byGroup.get(groupId);
  return Boolean(groupPermissions && (groupPermissions.has('*') || groupPermissions.has(permissionKey)));
}

export function hasPermissionInAnyGroup(effective: EffectivePermissions, permissionKey: Permission): boolean {
  for (const groupPermissions of effective.byGroup.values()) {
    if (groupPermissions.has('*') || groupPermissions.has(permissionKey)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Resolving a caller's ArticleSearchGrants (lib/search.ts) from live Group.dataAccess
// data — the piece that bridges "who is asking, for which permission" to "what can
// buildArticleSearchQuery/executeArticleFacets actually let them see."
//
// Two paths, mirroring lib/group-scope.ts's resolveDocumentScope but expressed in
// ArticleSearchGrants' project/hard-concept shape instead of a flat groupId list:
//
//   1. Global-scope grant (wildcard, or a groupId:null roleAssignment carrying
//      `permissionKey`) -> every project in the org, no hard-filter restriction at all.
//      A global grant isn't scoped to any one Group, so there's no Group.dataAccess row
//      to intersect against.
//   2. Otherwise -> the user's *current* group (User.currentGroupId — "last-selected
//      navbar group", see @content-insights/shared's User type) must itself carry
//      `permissionKey` (re-resolved fresh from live Role docs, never trusted from the
//      JWT — same reasoning as requireScopedPermission.ts), and grants come from that
//      one Group's dataAccess.
// ---------------------------------------------------------------------------

async function resolveCurrentGroupId(user: AuthenticatedUser): Promise<string | null> {
  const doc = await UserModel.findById(user.id, { currentGroupId: 1 });
  return doc?.currentGroupId ? doc.currentGroupId.toString() : null;
}

export async function resolveArticleSearchGrants(
  user: AuthenticatedUser,
  permissionKey: Permission,
): Promise<ArticleSearchGrants> {
  if (hasGlobalPermission(user, permissionKey)) {
    const projects = await ProjectModel.find({ orgId: user.orgId }, { _id: 1 });
    const projectIds = projects.map((project) => project._id.toString());
    // Search itself stays unrestricted (empty hardFilterGrants). Facets still need every
    // concept key so FilterPanel sections like Key Phrases / Countries are not empty.
    const concepts =
      projectIds.length > 0
        ? await ConceptModel.find({ orgId: user.orgId, projectId: { $in: projectIds } }, { key: 1 })
        : [];
    return {
      projectIds,
      hardFilterGrants: [],
      softFilterConceptKeys: Array.from(new Set(concepts.map((concept) => concept.key))),
    };
  }

  const currentGroupId = await resolveCurrentGroupId(user);
  const effective = currentGroupId ? await resolveUserEffectivePermissions(user) : null;
  if (!currentGroupId || !effective || !hasPermissionInGroup(effective, permissionKey, currentGroupId)) {
    throw new ForbiddenError(`Missing required permission: ${permissionKey}`);
  }

  const group = await GroupModel.findOne({ _id: currentGroupId, orgId: user.orgId });
  if (!group) {
    throw new ForbiddenError(`Missing required permission: ${permissionKey}`);
  }

  const projectIds = group.dataAccess.projectIds.map((id) => id.toString());

  const [hardConcepts, softConcepts] = await Promise.all([
    ConceptModel.find({ orgId: user.orgId, projectId: { $in: projectIds }, placement: 'hard' }),
    ConceptModel.find(
      { orgId: user.orgId, projectId: { $in: projectIds }, placement: 'soft' },
      { key: 1 },
    ),
  ]);

  const grantByConceptId = new Map(
    group.dataAccess.hardFilterGrants.map((grant) => [grant.conceptId.toString(), grant]),
  );
  // Exhaustiveness contract (see ArticleSearchGrants' own comment in lib/search.ts): every
  // hard-placement concept in an accessible project must appear here, even ones the group
  // has no persisted grant row for — those default to allowedValues: [], which is what
  // makes "no grant row" become "zero results" for that concept rather than silently
  // falling through as unrestricted.
  const hardFilterGrants: HardFilterGrantWithKey[] = hardConcepts.map((concept) => {
    const grant = grantByConceptId.get(concept._id.toString());
    return {
      conceptId: asConceptId(concept._id.toString()),
      conceptName: concept.name,
      allowedValues: grant?.allowedValues ?? [],
      ...(grant?.denialNote ? { denialNote: grant.denialNote } : {}),
      conceptKey: concept.key,
      projectId: concept.projectId.toString(),
    };
  });

  return {
    projectIds,
    hardFilterGrants,
    softFilterConceptKeys: softConcepts.map((concept) => concept.key),
  };
}

// ---------------------------------------------------------------------------
// Per-article direct-access check — the same selected-∩-granted rule
// buildArticleFilterClauses applies at the query level (lib/search.ts), applied instead
// to one already-fetched article's own field values. Used by GET/PATCH/download/preview
// (single-article routes that bypass Elasticsearch entirely) so a caller can never fetch
// by id something a search would have filtered out. Deliberately does NOT check `hidden`
// — hidden only affects default LIST visibility, not direct access, per the brief.
// ---------------------------------------------------------------------------

export interface ArticleAccessSubject {
  projectId: string;
  taxonomyValues: Record<string, string[]>;
}

export function canAccessArticle(article: ArticleAccessSubject, grants: ArticleSearchGrants): boolean {
  if (!grants.projectIds.includes(article.projectId)) return false;

  // Only the hard-filter grants belonging to THIS article's own project apply — a grant for
  // a different granted project (e.g. that project's own, unrelated "Website Domain/Source"
  // concept) must never be checked against an article that isn't even in that project (it
  // won't carry that concept's field at all, which would otherwise always fail the check).
  for (const grant of grants.hardFilterGrants) {
    if (grant.projectId !== article.projectId) continue;
    const allowed = new Set(grant.allowedValues);
    const values = article.taxonomyValues[grant.conceptKey] ?? [];
    if (!values.some((value) => allowed.has(value))) return false;
  }

  return true;
}
