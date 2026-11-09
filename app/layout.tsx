import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "./component/header";
import Footer from "./component/footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // This is Our website title to show in server and browser
  title: "Wrool-AI",
  // This is Our website description to show in server and browser
  description: "Developed by Wrool-Team, Powered by Wrool IT Solutions",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* This is Header BAr to usse every page */}
      <Header />
      {/* This is body layout to use Laptop Mobile and Tap responsive */}
      <body className="min-h-full flex flex-col">{children}</body>
      {/* This is Footer to use every page*/}
      <Footer />
    </html>
  );
}
