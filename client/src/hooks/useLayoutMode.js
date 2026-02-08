import { useEffect, useState } from "react";

export default function useLayoutMode({ themeMode, setSideOpen }) {
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    window.matchMedia("(max-width: 1024px)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1024px)");
    const update = () => setIsMobileLayout(query.matches);
    update();
    if (query.addEventListener) {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    if (isMobileLayout) {
      setSideOpen(false);
    }
  }, [isMobileLayout, setSideOpen]);

  return { isMobileLayout };
}
