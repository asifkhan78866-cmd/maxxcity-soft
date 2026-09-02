// Root route: send each visitor to the screen their role can actually use.
// A signed-in cashier lands on the POS, a manager or admin on the dashboard,
// and anyone without a session on the login page.

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/guard';
import { landingRouteFor } from '@/lib/auth/rbac';

export default async function Home() {
  const session = await getSession();
  redirect(session ? landingRouteFor(session.role) : '/login');
}
