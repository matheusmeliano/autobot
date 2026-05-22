import "./globals.css";
import { Providers } from "@/components/Providers";

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><defs><linearGradient id="bot-gradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop stop-color="#6366f1" offset="0%"/><stop stop-color="#10b981" offset="100%"/></linearGradient></defs><rect x="1.5" y="1.5" width="33" height="33" rx="12" fill="#11141A" stroke="#FFFFFF1A" stroke-width="1"/><g transform="translate(8 8) scale(0.8333333333)" fill="none" stroke="url(#bot-gradient)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></g></svg>`;

export const metadata = {
  title: "AutoBot",
  description: "Cobrança automática via WhatsApp com PIX",
  icons: {
    icon: [{ url: `data:image/svg+xml,${encodeURIComponent(faviconSvg)}` }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
