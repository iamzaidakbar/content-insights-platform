export type Branded<T, B extends string> = T & { readonly __brand: B };

export type OrgId = Branded<string, 'OrgId'>;
export type UserId = Branded<string, 'UserId'>;
export type RoleId = Branded<string, 'RoleId'>;
export type DocumentId = Branded<string, 'DocumentId'>;

// Narrowing helpers only — they do not validate. See src/validators for
// parsing untrusted input (e.g. request params) into these branded types.
export const asOrgId = (value: string): OrgId => value as OrgId;
export const asUserId = (value: string): UserId => value as UserId;
export const asRoleId = (value: string): RoleId => value as RoleId;
export const asDocumentId = (value: string): DocumentId => value as DocumentId;
