'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: '行事曆', icon: '🗓' },
  { href: '/cards', label: '信用卡', icon: '💳' },
  { href: '/todos', label: '待辦', icon: '✅' },
  { href: '/expenses', label: '記帳', icon: '🧾' },
  { href: '/insights', label: '分析', icon: '📊' },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} data-active={pathname === tab.href}>
          <span className="icon" aria-hidden>
            {tab.icon}
          </span>
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
