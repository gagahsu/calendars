import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import Nav from '@/components/Nav';

/**
 * Auth gate for every signed-in page. Route handlers check the session
 * independently, so this is about navigation, not about being the only guard.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticated())) redirect('/login');

  return (
    <>
      <div className="shell">{children}</div>
      <Nav />
    </>
  );
}
