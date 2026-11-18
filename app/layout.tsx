import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./typography.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-montserrat",
  fallback: ["Arial", "Helvetica", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Spotly — Know what’s happening, anywhere.",
  icons: { icon: "/icon.svg" },
  description:
    "Know what’s happening, anywhere. Fresh, location-specific verification for real-world operations. Explore the Spotly demo workspace.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
