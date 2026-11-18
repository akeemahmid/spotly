"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAnimate } from "motion/react-mini";
import { ArrowUpRight, Camera, ClipboardList, FileText, MapPin, Pause, Play, UserRound } from "lucide-react";
import { manageSceneMotion } from "./motion-lifecycle";

const stages = ["Request", "Observe", "Review", "Decide"];
const times = [0, 0.025, 0.21, 0.25, 0.46, 0.5, 0.71, 0.75, 0.96, 1];
const activeStage = [0, 0, 0, 1, 1, 2, 2, 3, 3, 0];

export function SpotlyHeroScene() {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const id = useId().replaceAll(":", "");
  const controller = useRef<ReturnType<typeof manageSceneMotion> | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const element = scope.current;
    const options = { duration: 10, repeat: Infinity, ease: "linear" as const, times };
    const manager = manageSceneMotion(element, () => {
      const cards = stages.map((_, index) => animate(`[data-scene-card="${index}"]`, {
        transform: activeStage.map((active) => active === index ? "translateY(-8px)" : "translateY(0px)"),
      }, options));
      const highlights = stages.map((_, index) => animate(`[data-stage-light="${index}"]`, {
        opacity: activeStage.map((active) => active === index ? 1 : 0),
      }, options));
      return [...cards, ...highlights,
        animate(".scene-packet", {
          transform: ["translate(205px, 190px)", "translate(205px, 190px)", "translate(397px, 264px)", "translate(397px, 264px)", "translate(205px, 190px)"],
          opacity: [0, 1, 1, 0, 0],
        }, { duration: 10, repeat: Infinity, times: [0, 0.25, 0.43, 0.48, 1], ease: "easeInOut" }),
        animate(".scene-marker-halo", { transform: ["scale(1)", "scale(1.6)", "scale(1)"], opacity: [0.45, 0, 0.45] }, { duration: 2.5, repeat: Infinity }),
      ];
    });
    controller.current = manager;
    return () => { manager.destroy(); controller.current = null; };
  }, [animate, scope]);

  function togglePause() {
    const next = !paused;
    setPaused(next);
    controller.current?.setPaused(next);
  }

  return (
    <figure className="spotly-scene" aria-labelledby={`${id}-caption`}>
      <div className="scene-topline"><span><span className="scene-small-cross">＋</span> THE OBSERVATION ATLAS</span><span>CONCEPT / 01</span></div>
      <div className="scene-canvas" ref={scope} data-motion="static">
        <div className="scene-orbit scene-orbit-one" aria-hidden="true" />
        <div className="scene-orbit scene-orbit-two" aria-hidden="true" />
        <svg className="scene-map" viewBox="0 0 640 500" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`${id}-surface`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#eef7e9" /><stop offset="1" stopColor="#c5e9d4" /></linearGradient>
            <pattern id={`${id}-grid`} width="32" height="32" patternUnits="userSpaceOnUse" patternTransform="matrix(1 .5 -1 .5 320 90)"><path d="M32 0H0V32" fill="none" stroke="#fff" strokeOpacity=".65" strokeWidth="1" /></pattern>
            <clipPath id={`${id}-clip`}><path d="M48 245 320 99 598 245 326 397Z" /></clipPath>
          </defs>
          <ellipse cx="324" cy="348" rx="225" ry="85" fill="#126b53" opacity=".06" />
          <path d="M48 245 326 397 598 245V267L326 420 48 267Z" fill="#a1cbb6" />
          <path d="M48 245 326 397V420L48 267Z" fill="#bbdcca" />
          <path d="M48 245 320 99 598 245 326 397Z" fill={`url(#${id}-surface)`} stroke="#b3d3c0" />
          <g clipPath={`url(#${id}-clip)`}>
            <path d="M48 245 320 99 598 245 326 397Z" fill={`url(#${id}-grid)`} />
            <path d="M84 216 403 383M217 155 513 312M150 313 445 153" fill="none" stroke="#c4d7c7" strokeWidth="27" />
            <path d="M84 216 403 383M217 155 513 312M150 313 445 153" fill="none" stroke="#fbfdf7" strokeWidth="20" />
            <path d="M84 216 403 383M217 155 513 312M150 313 445 153" fill="none" stroke="#b2c9b8" strokeWidth="1.5" strokeDasharray="7 9" />
            <path d="m104 262 38-20 45 24-39 21Zm274-85 39-21 41 22-39 21ZM259 336l40-21 43 23-40 22Z" fill="#a4d5b4" />
            <path d="m261 210 39-21 39 21-39 21Z" fill="#a7c7b5" /><path d="M261 210v-24l39 21v24Z" fill="#c3dbca" /><path d="m261 186 39-21 39 21-39 21Z" fill="#f8fbf5" /><path d="M300 207v24l39-21v-24Z" fill="#8db59f" />
            <path d="m429 271 32-17 30 16-32 18Z" fill="#a7c7b5" /><path d="M429 271v-35l30 17v35Z" fill="#c3dbca" /><path d="m429 236 32-17 30 16-32 18Z" fill="#f8fbf5" /><path d="M459 253v35l32-18v-35Z" fill="#8db59f" />
            <path d="M205 190 397 264 303 315" fill="none" stroke="#126b53" strokeWidth="3" strokeDasharray="5 7" opacity=".7" />
          </g>
          <g className="scene-pin" transform="translate(397 264)"><ellipse rx="27" ry="13" fill="#126b53" opacity=".12" /><g className="scene-marker-halo"><ellipse rx="24" ry="12" fill="none" stroke="#126b53" strokeWidth="2" /></g><path d="M0 0S-16-20-16-30a16 16 0 1 1 32 0C16-20 0 0 0 0Z" fill="#126b53" /><circle cy="-30" r="5" fill="#bbf7d0" /></g>
          <g transform="translate(205 190)"><ellipse rx="15" ry="7" fill="#126b53" opacity=".13" /><path d="M0 0S-10-13-10-20a10 10 0 0 1 20 0C10-13 0 0 0 0Z" fill="#f3b352" /><circle cy="-20" r="3" fill="#fff" /></g>
          <g className="scene-packet" opacity="0"><circle r="9" fill="#fff" /><circle r="4" fill="#126b53" /></g>
          <g fill="#6e8f7b"><circle cx="157" cy="208" r="4" /><circle cx="475" cy="218" r="4" /><circle cx="343" cy="351" r="4" /></g>
        </svg>
        <div className="scene-card scene-request" data-scene-card="0">
          <div className="scene-card-heading"><span className="scene-icon"><ClipboardList size={17} /></span><span>01 / REQUEST</span><ArrowUpRight size={14} /></div>
          <strong>A question worth asking.</strong><p>What’s visible at this location?</p>
          <div className="scene-card-footer"><MapPin size={12} /> One location. Fresh context.</div>
        </div>
        <div className="scene-card scene-observer" data-scene-card="1">
          <span className="scene-person"><UserRound size={19} /></span><div><span>02 / OBSERVE</span><strong>Field verifier</strong><small>Capture an observation</small></div>
        </div>
        <div className="scene-card scene-evidence" data-scene-card="2">
          <div className="scene-evidence-thumbnail" aria-hidden="true"><Camera size={26} /><span>ILLUSTRATIVE EVIDENCE</span></div>
          <div className="scene-evidence-text"><span>03 / REVIEW</span><strong>Evidence with context.</strong><small>Photo + written observation</small></div>
        </div>
        <div className="scene-card scene-report" data-scene-card="3">
          <div className="scene-card-heading"><span className="scene-icon scene-icon-amber"><FileText size={17} /></span><span>04 / DECIDE</span></div>
          <strong>Ready for human review.</strong><p>You decide the next move.</p>
          <div className="scene-report-lines" aria-hidden="true"><span /><span /><span /></div>
          <small>Context, not a safety certification.</small>
        </div>
        <ol className="scene-stages" aria-label="Illustrated workflow">
          {stages.map((stage, index) => <li key={stage}><span className="scene-stage-light" data-stage-light={index} aria-hidden="true" /><span className="scene-stage-number">0{index + 1}</span>{stage}</li>)}
        </ol>
      </div>
      <figcaption id={`${id}-caption`} className="scene-caption"><span>Conceptual workflow · not live activity</span><button type="button" className="scene-pause" onClick={togglePause} aria-label={paused ? "Play workflow animation" : "Pause workflow animation"} aria-pressed={paused}>{paused ? <Play size={12} /> : <Pause size={12} />}<span>{paused ? "Play" : "Pause"}</span></button></figcaption>
    </figure>
  );
}
