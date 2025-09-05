import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OSCC Softphone",
  description: "Open Source Call Center Softphone Application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
