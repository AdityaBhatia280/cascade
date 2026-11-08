# 10 — Sponsor Tracks and Judging (HackUTD 2026: ZeroDay)

**Scope:** what the CBRE and NVIDIA tracks ask for, how judging works, past winners, and lessons that carry over to Cascade. Target tracks are CBRE and NorthMark (NMC²); NVIDIA is undecided. **Researched:** 2026-11-07, the first day of the event.

Every claim has a source. **[official]** marks the organizer's or sponsor's own text. **[inferred]** marks my reading of past winners or of sponsor publications.

This file was trimmed from an earlier version that also covered an oilfield sponsor track (EOG Resources) and critiqued a design draft that no longer exists. Both were dropped; see "Dropped" at the end.

---

## Summary

- **Event.** HackUTD 2026 is themed **"ZeroDay"** and runs Nov 7–8, 2026 at UTD (ECSW). Hacking started at 12:00pm Saturday. A first Devpost submission is due by 11:00pm Saturday, final submissions by **12:00pm Sunday**, and judging runs 1–4pm Sunday. [official] https://zeroday.hackutd.co/ , https://hackutd-zeroday.devpost.com/
- **Track names found on the site:**
  - **NVIDIA:** "Use Nemotron Beyond a Chatbot"
  - **CBRE:** "Predict Before It Spreads"
  - Some search snippets attach "Predict Before It Spreads" to NVIDIA. The site itself shows it under CBRE.
  - The third sponsor track found was EOG Resources' (oilfield, out of scope). **No NorthMark (NMC²) track text was captured in this research** (see "What I could not find").
- **Entry rules.** "Each team may enter up to three sponsor tracks and one HackUTD track (Best Hardware, Best Design, or Virality)". Final submissions need a title, a description, a repo, the tracks entered, and a **demo video of at most 2 minutes**. [official] Devpost
- **Prizes.** NVIDIA awards **2 places**: 1st is 2× RTX 5080 plus $200 Brev credits, 2nd is 1× RTX 5080 plus $200 Brev credits. CBRE awards 3 (Sony XM5, Kindle, camera). [official]
- **Judging layers:**
  1. **General criteria** (Devpost): Innovation and Creativity, Technical Complexity, Completeness, Design, Impact, Presentation.
  2. **NVIDIA's four required components**, which double as its de facto criteria.
  - CBRE publishes no rubric. Its PDF says "To earn top points, your submission must feature a clear, live-demoable, working prototype".
- **Judging format.** HackUTD runs **Jury**, a pairwise/ranking judging system (https://github.com/hackutd/jury-Zeroday). The 2024 Devpost described "expo style … 3–5 minutes … Some judges will be sponsors". Expect short demos.
- **Most important findings for Cascade:**
  1. CBRE's prompt is about **commercial real estate** (office towers, retail, data centers; HVAC, access control, leases, utilities, tenant SLAs), and names "high-density facilities like data centers" and "cascading power outages" explicitly.
  2. CBRE says its datasets/resources "Will be provided after the opening ceremony in the CBRE Discord Channel". I could not see them.
  3. A past winner, **DataDriver/DataPilot**, won **NVIDIA + Northmark** in 2025 with a data-center technician copilot. It is the only NorthMark evidence in this research.
  4. Last year's NVIDIA winner **Alchemetrics** used a Nemotron planner, FastAPI, OR-Tools and visible reasoning traces. The pattern has won before, but judges have seen it before too.

---

## 1. NVIDIA — "Use Nemotron Beyond a Chatbot"

### Official prompt (verbatim, https://zeroday.hackutd.co/)
> In addition to using Nemotron, your project must include:
> - Beyond a Chatbot: Not just responding directly to prompts
> - Multi-step workflows: Agents that plan and execute complex tasks
> - Tool integration: Using external APIs and services intelligently
> - Real-world applicability: Solving actual problems

- **Datasets:** none. The NVIDIA card has no "Resources" link (the only NVIDIA link on the page is nvidia.com).
- **Rubric or weighting:** none published.
- **Hosted vs. local:** nothing says whether hosted Nemotron (build.nvidia.com / NIM) or a local deployment is required or scored. **No public statement rewards local GPU use.**
- **Public repo:** I found no NVIDIA starter repo for HackUTD 2026.
- **Possibly related:** the HackUTD org published an "Agents, Tools, MCP" workshop repo (Gemini-based orchestrator with sub-agents as tools), which shows the pattern the organizers teach. https://github.com/hackutd/AgentsDemo

### What NVIDIA asks for at other recent Nemotron/agent hackathons [official, other events]
- **NeMo Agent Toolkit hackathon** (NVIDIA blog, 2025-07-17): judged on "real-world applicability, technical execution," and "how effectively they demonstrated agentic AI in action". The 1st-place winner chained an agent → cuOpt → Omniverse simulation validation → Jetson deployment. https://developer.nvidia.com/blog/hackathon-winners-bring-agentic-ai-to-life-with-the-nvidia-nemo-agent-toolkit/
- **Nebius × NVIDIA Global AI Hackathon 2026:** four equally weighted criteria (Technological Implementation, Design, Potential Impact, Quality of the Idea). Technological Implementation asks how effectively the project uses "NVIDIA Nemotron as part of the solution". I took this from search snippets of https://nebiusglobalaihackathon.devpost.com/ and did not verify it on the page.
- **NemoClaw × ASUS @ UCSC:** Creativity, Functionality ("meaningful integration of the tech stack"), Scope of Completion. https://nemoclaw.devpost.com/ (search snippet)
- **Pattern [inferred]:** NVIDIA judges reward agents that do real work through tools, show they work live, and integrate the NVIDIA stack meaningfully. None of these rubrics scores GPU usage as such.

### Past HackUTD NVIDIA winners (2025, "Lost in the Pages", 3 places; Devpost doesn't show which place each took)
- **Alchemetrics** — https://devpost.com/software/abc-xapnio. Built on the 2025 EOG challenge dataset (Poyo's Potion Factory: cauldron levels, transport tickets, overflow forecasts, witch routes).
  - "We built a multi-agent system orchestrated by Nemotron (NVIDIA's LLM planner). Nemotron decides which agent/tool to call next, logs all reasoning…"
  - Stack: "FastAPI … Postgres … NumPy/Pandas/OR-Tools … Next.js + Tailwind". Agents: Planner, Event Detection, Ticket Matching, Discrepancy Auditor, Forecasting, UI.
  - Its stated lesson: "Why keeping reasoning traces visible is critical when you automate decisions."
- **DataDriver/DataPilot** — https://devpost.com/software/datadriver. Won NVIDIA + Northmark. A data-center technician copilot: Nemotron generates "step by step work plans, inspect real time inventory availability, and replan tasks when issues arise." LangChain + NeMo, Flask, MongoDB, React.
- **Toyotron** — https://devpost.com/software/toyotron. Won NVIDIA + Toyota. A Nemotron agent that also triggers **real external actions**: emailing quotes, booking appointments, and phone-style calls. "Delivering an end-to-end experience that feels like a dedicated sales assistant rather than a static chatbot."

### Common patterns [inferred from winners]
1. Nemotron acts as a **planner/orchestrator** over deterministic tools, not as a chat front end.
2. **Replanning** when something changes (DataDriver).
3. **Visible reasoning/tool traces** in the UI (Alchemetrics).
4. At least one winner made **real external side-effects** (email, scheduling).
5. Every winner also counted toward a second sponsor track. Double-dipping is normal.

### Implications if Cascade enters NVIDIA [inferred]
- The likely weak spot is **"Tool integration: Using external APIs and services intelligently."** In-process tools alone may read as thin. Add at least one real external service, for example:
  - send a notice or work order by email/SMS/Slack/Discord
  - call Nemotron itself through NVIDIA's hosted API
- Make **replanning visible** when a constraint changes.
- Since Alchemetrics already did "Nemotron planner + OR-Tools + reasoning trace", explain what is new, e.g. verify/replan loops and cross-source facility data.
- Local RTX 6000 use is not a stated criterion. Hosted Nemotron is fine for scoring as far as anything public says. Model and serving details are in `11-nemotron-integration.md`.

---

## 2. NorthMark (NMC²)

No NMC² prompt, rubric or dataset was captured in this research. The only related evidence is that **DataDriver/DataPilot** (data-center technician copilot, work plans, inventory, replanning; https://devpost.com/software/datadriver) won the Northmark track in 2025 alongside NVIDIA. Read the 2026 NMC² track text before relying on anything here.

---

## 3. CBRE — "Predict Before It Spreads"

### Official prompt
Website card (verbatim, https://zeroday.hackutd.co/):
> Build an application that connects fragmented real estate data to predict operational failures, quantify business impact, or execute solutions before disruptions spread!

Challenge PDF, "CBRE-ChallengeStatement-HackUTD2026.pdf". It is linked from the CBRE card: https://drive.google.com/file/d/17-J-pGUxcAlNo5y8-YV84kZDY42IXy5E/view. The PDF is footer-marked "proprietary & confidential" but publicly linked, so I quote it only sparingly:
- "Build an end-to-end process that uniquely connects fragmented real estate data— for example, to predict cascading operational failures, or quantify business impact, or execute direct solutions before disruptions spread. Your platform must move beyond passive visualization to deliver a functional working prototype."
- **Context ("The Invisible Network"):** "Behind every modern commercial property—from downtown office towers and retail hubs to high-density facilities like data centers—is an invisible web of dependent systems. Facilities management, access controls, HVAC systems, lease contracts, and utility connections all rely on one another…"
- **Examples of failure:** "a zero-day cybersecurity attack on a digital control system or an unmonitored telemetry anomaly in a facility's cooling loop can quietly cause severe hardware damage, breach tenant SLAs, and trigger cascading power outages".
- **"The Prediction to Break":** "Commercial property networks are too fragmented to detect hidden dependencies, leaving critical infrastructure exposed to unexpected cascades and inevitable operational failure."
- **Freedom of approach:** "We do not dictate your technical stack … You might train predictive machine learning models on live infrastructure telemetry, orchestrate agentic AI workflows that execute resolution plans, build self-updating dependency graphs, deploy real-time risk-scoring engines…"
- **Scoring hint:** "To earn top points, your submission must feature a clear, live-demoable, working prototype."
- **Data:** "Additional Resources — Will be provided after the opening ceremony in the CBRE Discord Channel." **I could not see the Discord, so I don't know what data CBRE provided.**
- **Contacts:** CBRE engineers Ubaid Khan, John Luke and Courtney Dickenson, reachable at the booth, on Discord, or by email (listed in the PDF).

The silos CBRE names (FM, access control, HVAC, leases, utilities) are researched in `07-fragmented-sources-and-entity-resolution.md`. CBRE's own data center publications are in `05-cbre-insights.md` §1–10, and its Smart FM claims in §11.

### Past HackUTD CBRE winners
- **2025** (the 2025 CBRE prompt text was not found):
  - **TrustEstate AI** (https://devpost.com/software/cbre-project): property search plus AI trust scores.
  - **Cura** (https://devpost.com/software/tbd-58ftpr): an agentic commercial-real-estate investment analyst using CrewAI, MCP and NVIDIA/NeMo.
  - **Pact** (https://devpost.com/software/autotract): vendor contract management on Solana + Gemini.
- **2024:**
  - **Apartment water monitoring** (https://devpost.com/software/apartment-monitoring): IoT gauges for property managers.
  - **EcoVerse** (https://devpost.com/software/ecoverse-5dczmp): a VR replica of office buildings with an AI assistant for energy and water.
  - **Greenify** (https://devpost.com/software/greenwise-y6o4bu): emissions calculator and map of CBRE locations.
- **Pattern [inferred]:**
  - Winners are always about **buildings/real estate and their operators** (property managers, investors, tenants).
  - CBRE has rewarded immersive 3D/VR building views before (EcoVerse, 2024). A twin can resonate if it shows a **building**.

### Implications for Cascade [inferred]
- The story should live in a **commercial property or data center**. Example chain: a building's electrical switchgear → chilled-water/cooling loop → server hall or tenant floor, with lease/SLA penalties and a vendor work order.
- Use **CBRE's Discord-provided data** if any exists, and label any synthetic additions.
- Show a hidden dependency being discovered, a cascade predicted, the business impact quantified (SLA breach, downtime $), and an action executed (work order / dispatch). That maps one-to-one onto CBRE's PDF.

---

## 4. Lessons that carry over (from the earlier risk list) [inferred]

1. **Self-verification can look circular.** Re-running our own simulator to confirm our own plan is weak evidence. Show **replanning** when a constraint changes, and be explicit about what is checked against independent data. (Cascade's README makes the same point about its DFW1 accuracy test measuring internal consistency.)
2. **NVIDIA's "external APIs and services" requirement** needs at least one real external integration, such as an email/SMS/Slack notification. Past winner Toyotron did exactly this.
3. **Stand out from Alchemetrics** by pitching what is new rather than "Nemotron planner + optimizer + trace".
4. **The demo must fit the format.** The Devpost video is capped at 2 minutes, and judging is short pairwise/expo demos. Script a 2-minute path.
5. **GPU emphasis is unrewarded.** Nothing public scores local RTX 6000 use. Hosted Nemotron satisfies "using Nemotron" as far as anything public says.

---

## What I could not find
- The contents of CBRE's Discord-provided resources and any CBRE rubric.
- **Any NorthMark (NMC²) track text, rubric or data for 2026.**
- Any NVIDIA rubric or weighting beyond the four required components, and whether hosted vs. local Nemotron matters.
- 2025 challenge statements for NVIDIA and CBRE.
- Prize placement (1st/2nd/3rd) for past winners. Devpost shows only "Winner".
- Anything for 2023.
- Any HackUTD Discord announcements mirrored publicly.
- A specific CBRE digital-twin product (see `05-cbre-insights.md` §11).

## Dropped (oilfield-only)

Removed from the earlier version: the EOG "Beat the Shutdown" track (prompt, judging list, test-network rules, dataset spec, truck/shut-in rules, suggested features, AI-directed README lines, past EOG winners 2024–25 and their pattern), EOG prizes, EOG's investor-deck framing of water reuse and real-time apps, and the 15-item critique of an earlier design draft that set the CBRE scenario in an oilfield. NVIDIA and CBRE implications that only applied to that draft (shared-truck planning, pump replanning examples, cross-domain oilfield reuse) were also dropped.
