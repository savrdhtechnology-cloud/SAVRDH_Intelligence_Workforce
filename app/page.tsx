"use client";

import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Database,
  Headphones,
  Layers3,
  LockKeyhole,
  MessageCircleMore,
  Network,
  PhoneCall,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import InteractiveHero from "./interactive-hero";
import InteractiveWorkflow from "./interactive-workflow";
import InteractiveEcosystem from "./interactive-ecosystem";
import AgentsShowcase from "./agents-showcase";

const agents = [
  {
    icon: PhoneCall,
    title: "SAV Sales",
    text: "Qualifies inbound leads, follows up with precision and keeps every opportunity moving forward.",
    stat: "42 leads queued",
  },
  {
    icon: Headphones,
    title: "SAV Support",
    text: "Resolves routine customer queries instantly, preserves context and escalates only what needs a human.",
    stat: "24×7 available",
  },
  {
    icon: BrainCircuit,
    title: "SAV Operations",
    text: "Runs repeatable operations, updates connected systems and keeps workflows moving without manual chasing.",
    stat: "86 actions ready",
  },
];

const channels = ["WhatsApp", "Email", "SMS", "Voice", "CRM", "Web"];

const features = [
  {
    icon: Bot,
    title: "AI Agents",
    text: "Deploy role-specific AI agents for sales, service, operations and internal execution.",
  },
  {
    icon: Workflow,
    title: "Workflow Automation",
    text: "Convert repetitive work into governed automations with rules, approvals and escalation paths.",
  },
  {
    icon: MessageCircleMore,
    title: "Omnichannel",
    text: "Manage customer communication across WhatsApp, email, SMS, voice and connected business systems.",
  },
  {
    icon: Database,
    title: "Knowledge + Memory",
    text: "Ground every agent in approved business knowledge while preserving the context needed to act intelligently.",
  },
  {
    icon: ShieldCheck,
    title: "Human Control",
    text: "Keep sensitive actions behind human approval with clear controls and a traceable activity history.",
  },
  {
    icon: BarChart3,
    title: "Live Analytics",
    text: "See what was completed, what is pending, channel outcomes and workforce performance in real time.",
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 36, filter: "blur(8px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const stagger = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.09,
      delayChildren: 0.08,
    },
  },
};

function BrandMark() {
  return (
    <motion.div
      className="brand-mark"
      aria-hidden="true"
      animate={{ rotate: [0, 4, -4, 0], scale: [1, 1.04, 1] }}
      transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
    >
      <span />
      <span />
      <span />
    </motion.div>
  );
}

function CommandPreview() {
  return (
    <motion.div
      className="console-shell"
      animate={{ y: [0, -10, 0], rotateX: [0, 1, 0], rotateY: [-3, -1.5, -3] }}
      transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      whileHover={{ scale: 1.015, y: -6 }}
    >
      <motion.div
        className="console-scanline"
        animate={{ y: ["-120%", "520%"] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "linear" }}
      />

      <div className="console-top">
        <div className="console-brand">
          <BrandMark />
          <div>
            <strong>SAV AI WORKFORCE</strong>
            <small>Command Center</small>
          </div>
        </div>
        <div className="system-ready"><span /> All Systems Ready</div>
      </div>

      <div className="console-body">
        <aside className="console-side">
          {["Dashboard", "AI Agents", "Voice", "Channels", "Workflows", "Knowledge", "Memory", "Escalation", "Analytics"].map((item, i) => (
            <motion.div
              className={i === 0 ? "mini-nav active" : "mini-nav"}
              key={item}
              whileHover={{ x: 5 }}
              transition={{ type: "spring", stiffness: 320, damping: 24 }}
            >
              <span className="mini-dot" />
              {item}
            </motion.div>
          ))}
        </aside>

        <div className="console-main">
          <div className="console-label"><span className="scan-dot" /> AI COMMAND CENTER</div>
          <motion.div
            className="command-box"
            animate={{ borderColor: ["#294E73", "#4b82b7", "#294E73"] }}
            transition={{ duration: 3.5, repeat: Infinity }}
          >
            <span className="prompt-label">Tell SAV AI what you want to do...</span>
            <div className="typed-line">
              <ChevronRight size={16} />
              Start following up with today&apos;s pending leads
              <span className="typing-cursor" />
            </div>
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.96 }}>
              EXECUTE <Zap size={14} />
            </motion.button>
          </motion.div>

          <div className="response-heading"><span className="scan-dot" /> AI RESPONSE</div>
          <motion.div
            className="response-box"
            animate={{ boxShadow: ["0 0 0 rgba(73,227,255,0)", "0 0 24px rgba(73,227,255,.08)", "0 0 0 rgba(73,227,255,0)"] }}
            transition={{ duration: 3.2, repeat: Infinity }}
          >
            <div className="response-icon"><Sparkles size={18} /></div>
            <div>
              <strong>SAV-Sales will contact 42 pending leads through WhatsApp.</strong>
              <div className="response-stats">
                <span><b>86</b> estimated actions</span>
                <span><b>No</b> approval required</span>
              </div>
            </div>
          </motion.div>

          <div className="agent-strip live-strip">
            <div><span className="live-dot" /> SAV-Sales</div>
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 4, repeat: Infinity, ease: "linear" }}>
              <RefreshCw size={13} />
            </motion.div>
            <div>Workflow running</div>
            <div><Activity size={13} /> Live activity</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}



function PulseBand({ label, items }: { label: string; items: string[] }) {
  return (
    <motion.div
      className="pulse-band"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.55 }}
    >
      <div className="pulse-band-label"><span /> {label}</div>
      <div className="pulse-band-track">
        {[...items, ...items].map((item, i) => (
          <motion.span
            key={item + i}
            animate={{ opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 2.4 + (i % 3) * 0.5, repeat: Infinity, delay: (i % 5) * 0.16 }}
          >
            <i />
            {item}
          </motion.span>
        ))}
      </div>
    </motion.div>
  );
}

function RevealSection({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className: string;
  id?: string;
}) {
  return (
    <motion.section
      className={className}
      id={id}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.18 }}
      variants={stagger}
    >
      {children}
    </motion.section>
  );
}

export default function Home() {
  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.25 });
  const heroY = useTransform(smoothProgress, [0, 0.22], [0, 110]);
  const heroOpacity = useTransform(smoothProgress, [0, 0.22], [1, 0.55]);
  const orbOneY = useTransform(smoothProgress, [0, 1], [0, 280]);
  const orbTwoY = useTransform(smoothProgress, [0, 1], [0, -220]);

  return (
    <main>
      <motion.div className="scroll-progress" style={{ scaleX: smoothProgress }} />

      <div className="ambient-stage" aria-hidden="true">
        <motion.span
          className="ambient-orb orb-a"
          style={{ y: orbOneY }}
          animate={{ x: [0, 80, 0], scale: [1, 1.16, 1] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.span
          className="ambient-orb orb-b"
          style={{ y: orbTwoY }}
          animate={{ x: [0, -100, 0], scale: [1, 0.9, 1] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.span
          className="ambient-orb orb-c"
          animate={{ x: [-40, 70, -40], y: [0, -90, 0], scale: [0.9, 1.18, 0.9] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="particle-field">
          {Array.from({ length: 18 }).map((_, i) => (
            <motion.i
              className={"particle p-" + (i + 1)}
              key={i}
              animate={{ y: [0, -140], opacity: [0, 0.8, 0], scale: [0.6, 1.15] }}
              transition={{ duration: 6 + (i % 5) * 1.4, repeat: Infinity, delay: (i % 6) * 0.45, ease: "linear" }}
            />
          ))}
        </div>
      </div>

      <motion.header
        className="site-header"
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <a className="logo" href="#top" aria-label="SAVRDH Intelligence Workforce">
          <BrandMark />
          <div>
            <span className="logo-main">SAVRDH</span>
            <span className="logo-sub">INTELLIGENCE WORKFORCE</span>
          </div>
        </a>
        <nav>
          <a href="#platform">Platform</a>
          <a href="#agents">AI Agents</a>
          <a href="#integrations">Integrations</a>
          <a href="#security">Security</a>
          <a href="/savrdhintelligenceworkforce/crm">Workspace Login</a>
        </nav>
        <motion.a className="header-cta" href="#contact" whileHover={{ y: -2, scale: 1.03 }} whileTap={{ scale: 0.97 }}>
          Request Demo <ArrowRight size={15} />
        </motion.a>
      </motion.header>

      <InteractiveHero />

      <RevealSection className="logo-band" >
        <motion.span className="band-label" variants={fadeUp}>ONE WORKFORCE. EVERY CHANNEL.</motion.span>
        <motion.div className="channel-marquee" variants={fadeUp}>
          <motion.div
            className="channel-track"
            animate={{ x: ["0%", "-50%"] }}
            transition={{ duration: 16, repeat: Infinity, ease: "linear" }}
          >
            {[...channels, ...channels].map((channel, i) => <span key={channel + i}>{channel}</span>)}
          </motion.div>
        </motion.div>
      </RevealSection>

      <RevealSection className="section platform-section" id="platform">
        <motion.div className="section-kicker" variants={fadeUp}>ONE INTELLIGENT WORKFORCE</motion.div>
        <motion.div className="section-heading" variants={fadeUp}>
          <h2>Turn repetitive business work into intelligent execution.</h2>
          <p>Bring AI agents, workflows, communication, knowledge, approvals and analytics into one secure command center — designed to move work forward without constant manual follow-up.</p>
        </motion.div>
        <motion.div className="feature-grid" variants={stagger}>
          {features.map(({ icon: Icon, title, text }) => (
            <motion.article
              className="feature-card"
              key={title}
              variants={fadeUp}
              whileHover={{ y: -10, scale: 1.02, rotateX: 2, rotateY: -2 }}
              transition={{ type: "spring", stiffness: 240, damping: 20 }}
            >
              <motion.div className="feature-icon" whileHover={{ rotate: -6, scale: 1.1 }}><Icon size={22} /></motion.div>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="learn-link">Built for business <ArrowRight size={14} /></span>
            </motion.article>
          ))}
        </motion.div>
      </RevealSection>

      <PulseBand
        label="LIVE WORKFORCE TELEMETRY"
        items={["42 leads queued", "86 actions ready", "24×7 support online", "CRM sync active", "Approval gates armed", "Knowledge memory connected"]}
      />

      <AgentsShowcase />

      <PulseBand
        label="AGENT COORDINATION BUS"
        items={["SAV-Sales active", "SAV-Support active", "SAV-Operations active", "Shared context live", "Audit trail recording", "Escalation routing ready"]}
      />

      <InteractiveWorkflow />

      <PulseBand
        label="EXECUTION FABRIC"
        items={["Trigger received", "Policy evaluated", "Channel selected", "Action executed", "CRM updated", "Outcome recorded"]}
      />

      <InteractiveEcosystem />

      <PulseBand
        label="CONNECTED SYSTEM STATUS"
        items={["WhatsApp online", "Voice online", "Email online", "Supabase online", "Webhooks online", "REST API online"]}
      />

      <RevealSection className="section security-section" id="security">
        <motion.div className="security-card" variants={fadeUp}>
          <div>
            <div className="section-kicker">GOVERNANCE BUILT INTO EVERY ACTION</div>
            <h2>Move faster without giving up control.</h2>
            <p>Control what every agent can access, automate low-risk actions, require approval where needed and keep a clear record of important activity.</p>
          </div>
          <div className="security-list">
            {["Approval gates", "Role-based access", "Escalation rules", "Activity history"].map((x, i) => (
              <motion.div key={x} whileHover={{ x: 7, scale: 1.01 }} initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}>
                <ShieldCheck size={18} /><span>{x}</span><CheckCircle2 size={17} />
              </motion.div>
            ))}
          </div>
        </motion.div>
      </RevealSection>

      <RevealSection className="cta-section" id="contact">
        <motion.div className="cta-orb" animate={{ scale: [1, 1.18, 1], opacity: [0.12, 0.24, 0.12] }} transition={{ duration: 5.5, repeat: Infinity }} />
        <motion.div className="section-kicker" variants={fadeUp}>SAVRDH INTELLIGENCE WORKFORCE</motion.div>
        <motion.h2 variants={fadeUp}>Put intelligent execution to work across your business.</motion.h2>
        <motion.p variants={fadeUp}>AI agents that communicate, coordinate and execute — while your team stays in control.</motion.p>
        <motion.div className="hero-actions cta-actions" variants={fadeUp}>
          <motion.a className="primary-btn" href="mailto:info@savrdhtechnologies.com" whileHover={{ y: -3, scale: 1.03 }}>
            Request a Live Demo <ArrowRight size={18} />
          </motion.a>
          <motion.a className="ghost-btn" href="https://savrdhtechnologies.com" whileHover={{ y: -3, scale: 1.02 }}>
            Visit Savrdh Technology
          </motion.a>
        </motion.div>
      </RevealSection>

      <motion.footer initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.8 }}>
        <div className="footer-brand"><BrandMark /><span>SAVRDH Intelligence Workforce</span></div>
        <p>© 2026 Savrdh Technology. All rights reserved.</p>
        <div className="footer-links">
          <a href="https://savrdhtechnologies.com">savrdhtechnologies.com</a>
          <a href="mailto:info@savrdhtechnologies.com">Contact</a>
        </div>
      </motion.footer>
    </main>
  );
}
