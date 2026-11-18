"use client";

import { useEffect, type ReactNode } from "react";
import { useAnimate } from "motion/react-mini";

/** Server-rendered content is visible by default; enhance only unseen sections. */
export function LandingReveal({ children, className = "", stagger = false }: {
  children: ReactNode;
  className?: string;
  stagger?: boolean;
}) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  useEffect(() => {
    const element = scope.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches || typeof IntersectionObserver === "undefined" || element.getBoundingClientRect().top < window.innerHeight) return;
    const targets = stagger ? Array.from(element.querySelectorAll<HTMLElement>("[data-reveal-item]")) : [element];
    // No content is hidden in SSR, without JS, or before a supported enhancement is ready.
    const original = targets.map((target) => ({ opacity: target.style.opacity, transform: target.style.transform }));
    let revealed = false;
    const restore = () => targets.forEach((target, index) => { target.style.opacity = original[index].opacity; target.style.transform = original[index].transform; });
    const preparation = targets.map((target) => animate(target, { opacity: 0, transform: "translateY(20px)" }, { duration: 0 }));
    let entrance: ReturnType<typeof animate>[] = [];
    const show = () => {
      if (revealed) return;
      revealed = true;
      preparation.forEach((control) => control.cancel());
      entrance = targets.map((target, index) => animate(target, {
        opacity: [0, 1], transform: ["translateY(20px)", "translateY(0px)"],
      }, { duration: 0.55, delay: stagger ? index * 0.085 : 0, ease: "easeOut" }));
      observer.disconnect();
    };
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) show(); }, { threshold: 0.08 });
    const finish = () => {
      revealed = true;
      observer.disconnect();
      [...preparation, ...entrance].forEach((control) => control.cancel());
      restore();
    };
    const reduce = () => { if (preference.matches) finish(); };
    observer.observe(element);
    preference.addEventListener("change", reduce);
    // Keyboard users must never focus content waiting for a scroll reveal.
    element.addEventListener("focusin", finish, { once: true });
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", reduce);
      element.removeEventListener("focusin", finish);
      [...preparation, ...entrance].forEach((control) => control.cancel());
      restore();
    };
  }, [animate, scope, stagger]);
  return <div className={`landing-reveal ${className}`} ref={scope}>{children}</div>;
}
