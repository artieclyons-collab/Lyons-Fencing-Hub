export default function manifest() {
  return {
    name: "Lyons Fencing Hub",
    short_name: "Lyons Fencing",
    description: "Business hub for Lyons Fencing & Services",
    start_url: "/",
    display: "standalone",
    background_color: "#1C1F1D",
    theme_color: "#E8B923",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
