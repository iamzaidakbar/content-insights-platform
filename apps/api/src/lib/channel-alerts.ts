import type { FilterPanelState } from '@content-insights/shared';

import { SavedSearchModel } from '../models/savedSearch.model.js';
import { UserModel } from '../models/user.model.js';
import { notifyMany } from '../services/notification.service.js';

function channelMatchesProject(filters: FilterPanelState, projectId: string): boolean {
  return filters.projectIds.length === 0 || filters.projectIds.includes(projectId);
}

export async function notifyDynamicChannelsForProject(orgId: string, projectId: string): Promise<void> {
  const channels = await SavedSearchModel.find({
    orgId,
    isChannel: true,
    isActive: true,
    type: 'dynamic',
  });
  const matching = channels.filter((channel) => channelMatchesProject(channel.filters, projectId));
  if (matching.length === 0) {
    return;
  }

  for (const channel of matching) {
    const groupIds = [
      channel.groupId.toString(),
      ...channel.sharedWithGroups.map((grant) => grant.groupId.toString()),
    ];
    const users = await UserModel.find(
      { orgId, isActive: true, 'roleAssignments.groupId': { $in: groupIds } },
      { _id: 1 },
    );
    const userIds = users.map((user) => user._id.toString());
    if (userIds.length === 0) {
      continue;
    }
    await notifyMany(userIds, {
      orgId,
      type: 'channel.new_results',
      title: `New articles in ${channel.channelName ?? channel.name}`,
      body: 'New matching articles arrived since you last viewed this channel.',
      entityType: 'savedSearch',
      entityId: channel._id.toString(),
    });
  }
}
