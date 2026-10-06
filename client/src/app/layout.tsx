import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vessel - Cloud IDE",
  description: "Spin up isolated Docker development sandboxes with real-time Monaco editor, bash terminal, and live preview.",
  icons: {
    icon: [
      { url: "/vessel-logo.png?v=3", type: "image/png" },
      { url: "/favicon.ico?v=3", type: "image/x-icon" },
    ],
    shortcut: "/vessel-logo.png?v=3",
    apple: "/vessel-logo.png?v=3",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/vessel-logo.png?v=3" type="image/png" />
        <link rel="shortcut icon" href="/vessel-logo.png?v=3" type="image/png" />
        <link rel="apple-touch-icon" href="/vessel-logo.png?v=3" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.addEventListener('error', function(e) {
                if (e && e.message && /Loading chunk .* failed/i.test(e.message)) {
                  var lastReload = sessionStorage.getItem('last_chunk_reload');
                  var now = Date.now();
                  if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
                    sessionStorage.setItem('last_chunk_reload', String(now));
                    window.location.reload();
                  }
                }
              }, true);
            `,
          }}
        />
      </head>
      <body className="bg-[#0B0D11] text-slate-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
