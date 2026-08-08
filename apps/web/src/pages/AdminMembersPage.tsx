import { Users } from 'lucide-react';

import ComingSoon from '../components/ComingSoon';

export default function AdminMembersPage() {
  return (
    <ComingSoon
      icon={Users}
      title="Members"
      description="Organization-wide member management is coming soon. Manage per-project members from a project's detail page for now."
    />
  );
}
