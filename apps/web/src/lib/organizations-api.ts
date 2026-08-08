import type { ApiResponse, OrganizationDetail, OrgId } from '@content-insights/shared';

import { apiClient } from './api-client';

export async function fetchOrganization(orgId: OrgId): Promise<OrganizationDetail> {
  const response = await apiClient.get<ApiResponse<OrganizationDetail>>(`/organizations/${orgId}`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function updateOrganization(orgId: OrgId, name: string): Promise<OrganizationDetail> {
  const response = await apiClient.patch<ApiResponse<OrganizationDetail>>(`/organizations/${orgId}`, {
    name,
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
