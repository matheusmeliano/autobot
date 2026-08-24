import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata = {
  title: "AutoBot",
  description: "Atendimento e mensagens automáticas",
  icons: {
    icon: [{ url: "/logo-autobot.png", type: "image/png" }],
    apple: [{ url: "/logo-autobot.png", type: "image/png" }],
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
