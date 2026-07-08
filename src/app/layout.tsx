import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Black Box",
  description: "A Filecoin-backed trace capsule prototype for AI agents."
};

type RootLayoutProps = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV === "development" ? (
          <Script id="suppress-metamask-network-noise" strategy="beforeInteractive">
            {`
              (() => {
                const message = "MetaMask: Received invalid network parameters";
                const shouldSuppress = (args) => args.some((arg) => typeof arg === "string" && arg.includes(message));
                const originalError = console.error.bind(console);

                console.error = (...args) => {
                  if (shouldSuppress(args)) {
                    return;
                  }

                  originalError(...args);
                };

                window.addEventListener(
                  "error",
                  (event) => {
                    if (typeof event.message === "string" && event.message.includes(message)) {
                      event.preventDefault();
                      event.stopImmediatePropagation();
                    }
                  },
                  true
                );
              })();
            `}
          </Script>
        ) : null}
        {children}
      </body>
    </html>
  );
}
