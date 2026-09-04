import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // A tab that says "Institutes · KUbeats" tells you where you are in a row of
  // twenty tabs; a bare app name does not.
  title: { default: "KUbeats — For a smarter KU", template: "%s · KUbeats" },
  description:
    "KUbeats — field reporting for the education sales team. For a smarter KU.",
  applicationName: "KUbeats",
  appleWebApp: { capable: true, title: "KUbeats", statusBarStyle: "default" },
};

// Mobile-first: reps use this on a phone, in the field.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The flame's red end, so the phone's browser chrome matches the app bar.
  themeColor: "#c0341c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
