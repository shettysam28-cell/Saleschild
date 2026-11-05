import Link from "next/link";
export default function Loading() {
  return (
    <div className="loading-state">
      <p role="status">Loading your workspace…</p>
      <p>Checking your account and organization access.</p>
      <Link href="/home" prefetch={false}>
        Taking longer? Reload workspace
      </Link>
      <p className="form-help">
        If this continues, retry once or contact your organization owner. Access stays protected if
        a service is unavailable.
      </p>
    </div>
  );
}
