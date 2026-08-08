import { Bell } from 'lucide-react';

import ComingSoon from '../components/ComingSoon';

export default function AlertsPage() {
  return (
    <ComingSoon
      icon={Bell}
      title="Alerts"
      description="Your breaking news, tag-match, and system alerts will appear here. Manage which alerts you receive in Settings."
    />
  );
}
