import { useEffect, useState } from 'react';
import { trimLogoWhitespace } from '../utils/logoTrim.ts';

interface CompanyLogoProps {
  src?: string;
  alt?: string;
  className?: string;
}

const DEFAULT_LOGO = '/src/assets/images/amiisaan_logo_1794870104636.jpg';

export function CompanyLogo({ src, alt = 'A-MIISAAN CONSTRUCTION CO. Logo', className = 'w-10 h-10' }: CompanyLogoProps) {
  const [failed, setFailed] = useState(false);
  const rawSrc = src && src.trim().length > 0 ? src : DEFAULT_LOGO;
  const [resolvedSrc, setResolvedSrc] = useState(rawSrc);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setResolvedSrc(rawSrc);
    void trimLogoWhitespace(rawSrc).then((trimmed) => {
      if (active && trimmed) {
        setResolvedSrc(trimmed);
      }
    });
    return () => {
      active = false;
    };
  }, [rawSrc]);

  if (failed) {
    return (
      <div
        className={`${className} rounded-md bg-[#0F2342] text-white flex items-center justify-center shrink-0 border border-slate-200`}
        aria-label={alt}
      >
        <svg viewBox="0 0 32 32" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M5 24L13 8L19 20L24 10L27 24" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 26H28" stroke="#0086D7" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} object-contain rounded-md bg-white border border-slate-200 shrink-0`}
    />
  );
}
