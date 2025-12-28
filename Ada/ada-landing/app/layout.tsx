import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "./providers";
import "./globals.css";

const coiny = localFont({
  src: "../public/fonts/Coiny-Regular.ttf",
  variable: "--font-coiny",
  display: "swap",
});

const ubuntu = localFont({
  src: "../public/fonts/Ubuntu-Medium.ttf",
  variable: "--font-ubuntu",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Delved AI - Your New Search Agent",
  description: "Delved AI is an AI-powered search agent that helps you research and explore any topic with ease.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${coiny.variable} ${ubuntu.variable} antialiased`}
      >
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
