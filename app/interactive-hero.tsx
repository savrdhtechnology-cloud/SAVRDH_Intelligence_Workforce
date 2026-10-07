"use client";

import { useEffect, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Headphones,
  Pause,
  PhoneCall,
  Play,
  RefreshCw,
  Sparkles,
  Zap,
} from "lucide-react";
import { openWorkforceDemo } from "./workforce-demo-modal";

const slides = [
  {
    id: "sales",
    no: "01",
    name: "SAV-Sales",
    role: "Autonomous Sales & Follow-up",
    icon: PhoneCall,
    prompt: "Start following up with today’s 42 pending leads on WhatsApp",
    badge: "42 leads queued",
    response: "SAV-Sales is contacting the target queue across WhatsApp and voice.",
    detail: "Intent scoring, structured follow-up, CRM synchronization and escalation when a human decision is needed.",
    actions: "86 estimated actions",
    approval: "Autonomous policy",
    channel: "WhatsApp + Voice",
  },
  {
    id: "support",
    no: "02",
    name: "SAV-Support",
    role: "24×7 Customer Care",
    icon: Headphones,
    prompt: "Resolve routine billing questions and search approved company knowledge",
    badge: "18 live conversations",
    response: "SAV-Support is resolving active conversations with approved knowledge.",
    detail: "Context recovery, grounded answers and a live handoff path for issues that need your team.",
    actions: "24 resolutions ready",
    approval: "Human gate on exceptions",
    channel: "WhatsApp + Email",
  },
  {
    id: "operations",
    no: "03",
    name: "SAV-Operations",
    role: "Workflow Execution & Governance",
    icon: BrainCircuit,
    prompt: "Reconcile pending operations tasks and route high-risk actions for approval",
    badge: "86 actions ready",
    response: "SAV-Operations is coordinating workflows across connected business systems.",
    detail: "Rule-based execution, audit-ready activity history and approval routing for sensitive actions.",
    actions: "14 workflows active",
    approval: "Policy-controlled",
    channel: "CRM + Database",
  },
];

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 280 : -280,
    opacity: 0,
    scale: 0.95,
    filter: "blur(6px)",
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 280 : -280,
    opacity: 0,
    scale: 0.95,
    filter: "blur(6px)",
  }),
};

export default function InteractiveHero() {
  const [[page, direction], setPage] = useState([0, 0]);
  const [autoplay, setAutoplay] = useState(true);
  const [executing, setExecuting] = useState(false);

  const index = ((page % slides.length) + slides.length) % slides.length;
  const slide = slides[index];
  const Icon = slide.icon;

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const sx = useSpring(mouseX, { stiffness: 180, damping: 24, mass: 0.55 });
  const sy = useSpring(mouseY, { stiffness: 180, damping: 24, mass: 0.55 });
  const rotateY = useTransform(sx, [-0.5, 0.5], [-6, 6]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [6, -6]);

  useEffect(() => {
    if (!autoplay) return;
    const id = window.setInterval(() => setPage(([p]) => [p + 1, 1]), 6000);
    return () => window.clearInterval(id);
  }, [autoplay]);

  const paginate = (dir: number) => setPage(([p]) => [p + dir, dir]);

  const jump = (target: number) => {
    const diff = target - index;
    if (diff !== 0) setPage(([p]) => [p + diff, diff]);
  };

  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5);
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5);
  };

  const execute = () => {
    setExecuting(true);
    window.setTimeout(() => setExecuting(false), 1400);
  };

  return (
    <section
      className="hero interactive-hero"
      id="top"
      onMouseMove={onMove}
      onMouseLeave={() => {
        mouseX.set(0);
        mouseY.set(0);
      }}
    >
      <div className="hero-glow glow-one" />
      <div className="hero-glow glow-two" />
      <div className="grid-overlay" />

      <motion.div
        className="hero-copy"
        initial={{ opacity: 0, x: -36 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="eyebrow hero-pill">
          <Sparkles size={14} />
          SAVRDH TECHNOLOGY CLOUD
          <span>·</span>
          Autonomous AI Agents
        </div>

        <h1>
          AI That Works Like a Team.<br />
          <span>Always On. Always Coordinated.</span>
        </h1>

        <p>
          Deploy intelligent AI agents that follow up, communicate, coordinate and execute work across your business — 24×7, across every channel, with human control where it matters.
        </p>

        <div className="hero-selector">
          <div className="selector-heading">
            <span>Explore live agent consoles</span>
            <b>0{index + 1} / 03</b>
          </div>
          <div className="selector-chips">
            {slides.map((item, i) => (
              <motion.button
                key={item.id}
                className={i === index ? "agent-chip active" : "agent-chip"}
                onClick={() => jump(i)}
                whileHover={{ scale: 1.035 }}
                whileTap={{ scale: 0.97 }}
              >
                <span>{item.no}</span>
                {item.name}
                {i === index && <i />}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="hero-actions">
          <motion.button type="button" onClick={openWorkforceDemo} className="primary-btn" whileHover={{ y: -3, scale: 1.03 }}>
            See SAV in Action <ArrowRight size={18} />
          </motion.button>
          <motion.a href="#workflow" className="ghost-btn" whileHover={{ y: -3, scale: 1.02 }}>
            <Play size={16} fill="currentColor" /> Explore Platform
          </motion.a>
        </div>

        <div className="trust-row">
          <span><CheckCircle2 size={15} /> Human-in-the-loop</span>
          <span><CheckCircle2 size={15} /> Live execution</span>
          <span><CheckCircle2 size={15} /> Omnichannel fabric</span>
        </div>
      </motion.div>

      <motion.div
        className="hero-product hero-console-wrap"
        initial={{ opacity: 0, x: 36, scale: 0.96 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ duration: 0.9, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
        style={{ rotateX, rotateY, transformPerspective: 1200 }}
      >
        <div className="hero-console-controls">
          <div className="console-tabs">
            {slides.map((item, i) => (
              <button key={item.id} onClick={() => jump(i)} className={i === index ? "active" : ""}>
                {i === index && <motion.span layoutId="console-active-pill" />}
                <b>{item.no}</b>
                <em>{item.name}</em>
              </button>
            ))}
          </div>

          <div className="console-nav-buttons">
            <button onClick={() => setAutoplay((v) => !v)} className={autoplay ? "playing" : ""}>
              {autoplay ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button onClick={() => paginate(-1)}><ArrowLeft size={14} /></button>
            <button onClick={() => paginate(1)}><ArrowRight size={14} /></button>
          </div>
        </div>

        <motion.div className="floating-badge badge-one" animate={{ y: [0, -8, 0] }} transition={{ duration: 4.4, repeat: Infinity }}>
          <span /> {slide.badge}
        </motion.div>
        <motion.div className="floating-badge badge-two" animate={{ y: [0, 8, 0] }} transition={{ duration: 5.2, repeat: Infinity }}>
          <Zap size={13} /> Agent executing: {slide.name}
        </motion.div>

        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={slide.id}
            className="console-shell interactive-console"
            variants={slideVariants}
            custom={direction}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
          >
            <motion.div className="console-scanline" animate={{ y: ["-120%", "520%"] }} transition={{ duration: 4.4, repeat: Infinity, ease: "linear" }} />

            <div className="console-top">
              <div className="console-brand">
                <div className="console-agent-icon"><Icon size={17} /></div>
                <div>
                  <strong>{slide.name}</strong>
                  <small>{slide.role}</small>
                </div>
              </div>
              <div className="system-ready"><span /> All Systems Ready</div>
            </div>

            <div className="console-body">
              <aside className="console-side">
                {["Dashboard", "AI Agents", "Voice", "Channels", "Workflows", "Knowledge", "Memory", "Escalation", "Analytics"].map((item, i) => (
                  <div className={i === index ? "mini-nav active" : "mini-nav"} key={item}>
                    <span className="mini-dot" />
                    {item}
                  </div>
                ))}
              </aside>

              <div className="console-main">
                <div className="console-label"><span className="scan-dot" /> AI COMMAND CENTER</div>

                <div className="command-box">
                  <span className="prompt-label">Tell SAV AI what you want to do...</span>
                  <div className="typed-line">
                    <ChevronRight size={16} />
                    {slide.prompt}
                    <span className="typing-cursor" />
                  </div>
                  <motion.button onClick={execute} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.96 }}>
                    {executing ? "RUNNING" : "EXECUTE"} <Zap size={14} />
                  </motion.button>
                </div>

                <div className="response-heading"><span className="scan-dot" /> AI RESPONSE</div>
                <motion.div
                  className="response-box"
                  animate={executing ? { scale: [1, 1.02, 1], borderColor: ["#294E73", "#49E3FF", "#294E73"] } : {}}
                >
                  <div className="response-icon"><Sparkles size={18} /></div>
                  <div>
                    <strong>{slide.response}</strong>
                    <p>{slide.detail}</p>
                    <div className="response-stats">
                      <span><b>{slide.actions}</b></span>
                      <span><b>{slide.approval}</b></span>
                    </div>
                  </div>
                </motion.div>

                <div className="agent-strip live-strip">
                  <div><span className="live-dot" /> {slide.name}</div>
                  <div><RefreshCw size={13} /> Workflow running</div>
                  <div><Activity size={13} /> {slide.channel}</div>
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </section>
  );
}
