'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Chat' },
  { href: '/trips', label: 'Meine Reisen' },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center justify-between bg-navy px-4 py-3 text-sm text-white">
      <Link href="/" className="font-mono font-semibold tracking-wide">
        TRIP·PLANNER
      </Link>
      <div className="flex gap-4">
        {LINKS.map((link) => {
          const isActive =
            link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                'pb-0.5 ' +
                (isActive ? 'border-b-2 border-teal-300' : 'opacity-80 hover:opacity-100')
              }
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}