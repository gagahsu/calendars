import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import LoginForm from '@/components/LoginForm';

export const metadata = { title: '登入 · 行事曆助理' };

export default async function LoginPage() {
  if (await isAuthenticated()) redirect('/');
  return <LoginForm />;
}
