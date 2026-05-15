import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata = {
  title: "AutoBot",
  description: "Cobrança automática via WhatsApp com PIX",
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
