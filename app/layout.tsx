import type { Metadata } from "next";
import "./globals.css";
import "./studio.css";
import "./research-tree.css";
import "./synthetic-data.css";
import "./release-desk.css";
import "./campus.css";
import "./studio-opening.css";
import "./studio-journey.css";
import "./studio-results.css";
import "./studio-staffing.css";
import "./studio-navigation.css";
import "./studio-research-method.css";
import "./studio-dark.css";
import "./studio-desktop-chrome.css";
import "./studio-desktop.css";
import "./studio-data-desktop.css";
import "./studio-decision-layout.css";
import "./training-flow.css";
import "./studio-task-navigation.css";
import "./campaign-origins.css";
import "./model-development-charts.css";
import "./model-designer.css";
import "./model-workspace.css";
import "./data-catalog.css";
import "./strategy-development.css";

export const metadata: Metadata = {
  title: "Frontier Lab - AI Company Strategy",
  description: "Build an AI company in a living isometric studio. Prepare data, train and evaluate models, hire your team, and serve your first paid customers. Studio and Classic share one campaign.",
  metadataBase: new URL("https://frontier-lab.nerdygeneral.chatgpt.site"),
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
