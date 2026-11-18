import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ClipboardCheck,
  Construction,
  FileCheck2,
  MapPin,
  PackageCheck,
  ScanLine,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { SpotlyHeroScene } from "@/components/marketing/spotly-hero-scene";
import { LandingReveal } from "@/components/marketing/landing-reveal";
import "./landing-motion.css";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";

const steps = [
  {
    number: "01",
    title: "Request",
    icon: ClipboardCheck,
    description:
      "Define the location, the question, and what evidence would help you decide.",
  },
  {
    number: "02",
    title: "Observe",
    icon: ScanLine,
    description:
      "A field verifier checks the location and captures fresh, relevant evidence.",
  },
  {
    number: "03",
    title: "Review",
    icon: FileCheck2,
    description:
      "Inspect the report and supporting evidence before accepting the result.",
  },
  {
    number: "04",
    title: "Decide",
    icon: ShieldCheck,
    description:
      "Use the reviewed observations to decide your next move. The decision stays with you.",
  },
];
const useCases = [
  {
    title: "Logistics and dispatch",
    icon: Truck,
    description:
      "Check road conditions and route access before sending a vehicle out.",
    example: "Is the northbound route clear?",
  },
  {
    title: "Delivery operations",
    icon: PackageCheck,
    description:
      "Understand entrance restrictions and delivery access before the last mile.",
    example: "Can a delivery van reach the entrance?",
  },
  {
    title: "Infrastructure checks",
    icon: Construction,
    description:
      "Request a fresh view of a road, worksite, or physical obstruction.",
    example: "Are roadworks blocking this junction?",
  },
  {
    title: "Field verification workflows",
    icon: ShieldCheck,
    description:
      "Bring location-specific questions, evidence, and review into one workflow.",
    example: "What does the site look like today?",
  },
];

export default function Home() {
  return (
    <div className="landing">
      <a className="skip-link" href="#landing-main">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-container landing-nav">
          <Brand />
          <nav aria-label="Main navigation">
            <a href="#product">Product</a>
            <a href="#how-it-works">How it works</a>
            <a href="#use-cases">Use cases</a>
          </nav>
          <Link className="button primary" href="/dispatcher">
            Open workspace <ArrowUpRight size={16} />
          </Link>
        </div>
      </header>
      <main id="landing-main">
        <section className="landing-hero landing-container">
          <div className="hero-copy">
            <span className="section-kicker">
              <span />
              REAL-WORLD VERIFICATION
            </span>
            <h1>
              Know what’s
              <br />
              happening,
              <br />
              <span>anywhere.</span>
            </h1>
            <p>
              Spotly lets businesses request fresh, location-specific observations
              from approved field verifiers. Ask a question, review the evidence,
              and make your next move with better context.
            </p>
            <div className="hero-actions">
              <Link href="/dispatcher" className="button primary">
                View dispatcher workspace <ArrowUpRight size={17} />
              </Link>
              <a href="#how-it-works" className="button hero-secondary">
                How it works <ArrowDown size={16} />
              </a>
            </div>
            <div className="hero-disclaimer">
              <span>
                <Check size={14} /> Email sign-in for your workspace
              </span>
              <span>Phase 3A · Persistent requests</span>
            </div>
          </div>
          <SpotlyHeroScene />
        </section>
        <div className="landing-principles landing-container">
          <span>BETTER CONTEXT. BETTER DECISIONS.</span>
          <div>
            <MapPin size={17} /> Location-specific
          </div>
          <div>
            <ScanLine size={17} /> Evidence-led
          </div>
          <div>
            <ShieldCheck size={17} /> Review before approval
          </div>
        </div>
        <LandingReveal>
          <section
            className="problem-section landing-container"
            aria-labelledby="problem-heading"
          >
            <div>
              <span className="section-kicker">THE INFORMATION GAP</span>
              <h2 id="problem-heading">
                Some answers aren’t
                <br />
                on the internet. <span>Yet.</span>
              </h2>
            </div>
            <div className="problem-copy">
              <p>
                A map can show you the road. It can’t always tell you what’s
                happening there right now.
              </p>
              <p>
                When a decision depends on road conditions, route access, site
                accessibility, or a field check, fresh information from the ground
                can make all the difference.
              </p>
              <div className="problem-tags">
                <span>Road conditions</span>
                <span>Route access</span>
                <span>Site accessibility</span>
                <span>Field verification</span>
              </div>
            </div>
          </section>
        </LandingReveal>
        <section id="how-it-works" className="how-section">
          <div className="landing-container">
            <div className="section-heading">
              <div>
                <span className="section-kicker">
                  A CLEAR PATH FROM ASK TO ANSWER
                </span>
                <h2>From uncertainty to your next move.</h2>
              </div>
              <p>
                One considered workflow.
                <br />
                Every step in your control.
              </p>
            </div>
            <LandingReveal stagger>
              <ol className="steps-grid">
                {steps.map(({ number, title, icon: Icon, description }) => (
                  <li key={title} data-reveal-item>
                    <div className="step-top">
                      <Icon size={24} />
                      <span>{number}</span>
                    </div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </li>
                ))}
              </ol>
            </LandingReveal>
            <p className="scope-note">
              <ShieldCheck size={15} />
              The intended Spotly workflow. The current prototype supports saved requests and observation
              planning; field verification, evidence
              review, and payouts are not connected.
            </p>
          </div>
        </section>
        <section id="use-cases" className="use-cases-section landing-container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">
                BUILT AROUND THE PHYSICAL WORLD
              </span>
              <h2>
                For decisions that can’t wait
                <br />
                for an outdated answer.
              </h2>
            </div>
            <p>
              Starting with logistics.
              <br />
              Designed for a wider world.
            </p>
          </div>
          <LandingReveal>
            <div className="use-case-grid">
              {useCases.map(
                ({ title, icon: Icon, description, example }, index) => (
                  <article className="use-case-card" key={title}>
                    <div className="use-case-top">
                      <span>
                        <Icon size={24} />
                      </span>
                      <span>0{index + 1}</span>
                    </div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                    <div className="use-case-example">
                      <span />“{example}”
                    </div>
                  </article>
                ),
              )}
            </div>
          </LandingReveal>
        </section>
        <section id="product" className="product-section">
          <div className="landing-container">
            <div className="product-heading">
              <span className="section-kicker">THE DISPATCHER WORKSPACE</span>
              <h2>
                A wider view.
                <br />A more confident next move.
              </h2>
              <p>
                Your requests, locations, and verification status — together in
                one calm, focused workspace.
              </p>
              <Link href="/dispatcher" className="text-button">
                Explore the demo <ArrowRight size={17} />
              </Link>
            </div>
            <LandingReveal className="product-preview-entrance"><WorkspacePreview /></LandingReveal>
            <p className="preview-caption">
              A preview of the dispatcher workspace. All requests, statuses, and
              locations shown are demo data.
            </p>
          </div>
        </section>
        <LandingReveal>
          <section className="final-cta landing-container">
            <div>
              <span className="section-kicker">YOUR NEXT MOVE STARTS HERE</span>
              <h2>
                Less guessing.
                <br />
                More ground truth.
              </h2>
              <p>Create a workspace for your verification requests.</p>
            </div>
            <div>
              <Link href="/dispatcher" className="button primary">
                Open workspace <ArrowUpRight size={18} />
              </Link>
              <span>Create an account to save your requests.</span>
            </div>
          </section>
        </LandingReveal>
      </main>
      <footer className="landing-footer">
        <div className="landing-container">
          <Brand />
          <p>Know what’s happening, anywhere.</p>
          <span>
            SERV Hackathon 02 <span> / </span> Phase 3A prototype
          </span>
        </div>
      </footer>
    </div>
  );
}
