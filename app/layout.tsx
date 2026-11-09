import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Pilots Dispatch",
  description:
    "Territory intelligence, airport defense, and expansion planning for any company in Pocket Pilots.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/vendor/leaflet.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
