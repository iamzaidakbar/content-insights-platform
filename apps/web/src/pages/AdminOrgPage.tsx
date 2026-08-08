import { useAuth } from '../auth/AuthContext';

export default function AdminOrgPage() {
  const { org } = useAuth();

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Organization</h1>
      <p className="mt-1 text-sm text-slate-400">Your organization&apos;s settings.</p>

      <div className="mt-6 space-y-4">
        <div>
          <span className="block text-sm font-medium text-slate-300">Name</span>
          <p className="mt-1 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-100">
            {org?.name ?? '—'}
          </p>
        </div>

        <div>
          <span className="block text-sm font-medium text-slate-300">Slug</span>
          <p className="mt-1 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-400">
            {org?.slug ?? '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">The organization slug cannot be changed.</p>
        </div>
      </div>
    </div>
  );
}
