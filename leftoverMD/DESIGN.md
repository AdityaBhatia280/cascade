# CASCADE — Design System

**Version:** 1.0  
**Product:** Cascade — AI-Powered Commercial Building Intelligence  
**Design Direction:** Premium, minimal, architectural, enterprise SaaS

---

## 1. Brand Identity

### Overview

Cascade is an AI-powered commercial building operations platform that connects inspections, infrastructure monitoring, maintenance workflows, and intelligent emergency assistance.

Our design should communicate:

- **Intelligence:** Complex information made understandable.
- **Reliability:** A professional platform trusted by building operators.
- **Clarity:** Information is immediately accessible and actionable.
- **Connection:** Different building systems working together.
- **Precision:** Every recommendation is supported by evidence.

### Visual Inspiration

Draw inspiration from the visual simplicity of Linear, Brex, Vercel, and Stripe.

Do not directly copy their designs.

### Design Philosophy

**Complex infrastructure. Simple intelligence.**

Cascade should look like a premium enterprise software product, not a generic AI chatbot or futuristic robotics dashboard.

Avoid excessive gradients, glowing effects, decorative illustrations, glassmorphism, and overly rounded components.

---

## 2. Logo

### Primary Logo

The Cascade symbol consists of:

- A bold black capital C.
- Three ascending orange architectural segments.
- Smooth curves and clean negative space.
- A subtle visual reference to commercial buildings and interconnected infrastructure.

### Logo Usage

The standalone C symbol is the primary app icon.

The full wordmark can be used on the landing page, presentations, and marketing materials.

Rules:

- Preserve the original proportions.
- Never stretch or distort the logo.
- Maintain sufficient whitespace around it.
- Use the logo on white or light neutral backgrounds whenever possible.
- Do not add shadows, outlines, or unnecessary effects.
- Do not redraw the logo using CSS approximations.

Use the approved logo image asset directly.

---

## 3. Color System

### Primary Palette

| Color | Hex | Usage |
|---|---|---|
| Cascade Orange | `#FF5900` | Brand accents, primary actions |
| Black | `#111111` | Headings, navigation, primary text |
| White | `#FFFFFF` | Main backgrounds |
| Off White | `#FAFAFA` | Dashboard backgrounds |
| Light Gray | `#F3F4F6` | Secondary surfaces |
| Border Gray | `#E5E7EB` | Borders and dividers |
| Medium Gray | `#6B7280` | Secondary text |

### Semantic Colors

| Color | Hex | Usage |
|---|---|---|
| Success | `#15803D` | Healthy equipment, completed tasks |
| Warning | `#B45309` | Maintenance warnings |
| Critical | `#DC2626` | Confirmed critical incidents |
| Information | `#2563EB` | Informational notices |

### Color Rules

Orange is an accent, not the dominant background color.

Most interfaces should consist of white, black, and light gray.

Use orange for selected navigation items, primary actions, active indicators, and important visual highlights.

Use semantic colors only when they convey actual status.

Do not use orange to represent every warning or error.

---

## 4. Typography

### Primary Font

**Inter**

Fallback: `Arial, Helvetica, sans-serif`

### Type Scale

| Element | Size | Weight |
|---|---|---|
| Landing hero | 56–72px | 700 |
| Page heading | 32px | 650–700 |
| Section heading | 24px | 600 |
| Card heading | 18px | 600 |
| Body | 14–16px | 400 |
| Labels | 12–13px | 500 |
| Small metadata | 12px | 400 |
| Metric values | 28–36px | 650–700 |

### Typography Rules

- Use tight letter spacing on large headings.
- Keep body text highly readable.
- Use sentence case for most UI labels.
- Use tabular numbers for metrics, dates, and equipment readings.
- Avoid excessive bold text.
- Never use decorative or futuristic fonts.

---

## 5. Layout and Spacing

### Spacing Scale

Use an 8px-based spacing system with 4px increments where necessary.

`4, 8, 12, 16, 24, 32, 40, 48, 64`

### Border Radius

| Component | Radius |
|---|---|
| Buttons | 8px |
| Input fields | 8px |
| Cards | 12px |
| Modals | 12px |
| Badges | 6px |
| Dashboard panels | 12px |

### Borders and Shadows

Use subtle 1px borders.

Default border: `#E5E7EB`

Shadows should be minimal.

Prefer clear spacing and subtle borders over large drop shadows.

### Dashboard Layout

- Left sidebar: 240px
- Top navigation: 64px
- Main content: Flexible
- Content padding: 32px desktop
- Card gaps: 16–24px
- Maximum content width: 1440px

---

## 6. Core UI Components

### Buttons

**Primary**

- Background: `#FF5900`
- Text: White
- Radius: 8px
- Height: 40–44px

**Secondary**

- Background: White
- Border: `#E5E7EB`
- Text: `#111111`

**Danger**

- Reserved for destructive actions.
- Red background or red outlined variant.

### Cards

- White background
- 1px neutral border
- 12px radius
- 20–24px padding
- No heavy shadow

### Status Badges

Use concise labels:

- Healthy
- Warning
- Critical
- Offline
- Maintenance
- Resolved

Status must not be conveyed by color alone.

### Tables

Use clean tables with:

- Subtle horizontal dividers
- Clear column headings
- Search and filters
- Row hover states
- Right-aligned numerical values
- Pagination when necessary

### Charts

Charts should prioritize readability.

Use orange for the main highlighted series.

Use muted gray for secondary series.

Use green, amber, or red only for meaningful status comparisons.

Avoid 3D charts, unnecessary animation, and excessive chart decorations.

---

## 7. Main Application Screens

### Screen 1 — Building Overview

Purpose: Give building managers immediate visibility into building operations.

Layout:

**Top header**

- Building name
- Location
- Last updated timestamp
- Notification icon
- Building selector

**Overview metrics**

Four metric cards:

1. Overall Building Health
2. Active Incidents
3. Equipment Requiring Attention
4. Open Maintenance Tickets

**Main content**

Left:

- Infrastructure health overview
- HVAC status
- Security status
- Networking status

Right:

- Active incidents
- Recent alerts
- Priority maintenance recommendations

**Bottom section**

- Maintenance activity timeline
- Equipment health trends

Do not display fabricated health scores as real measurements. Scores must have defined calculation methods.

### Screen 2 — Equipment Management

Purpose: Browse and inspect commercial building assets.

Display:

- Equipment name
- Equipment ID
- System category
- Building and floor
- Installation date
- Last inspection
- Current status
- Assigned technician

Supported categories:

**HVAC:** Air handlers, chillers, rooftop units, thermostats.

**Security:** Cameras, recording systems, access-control devices.

**Networking:** Switches, routers, network controllers.

Equipment details should include maintenance history, uploaded reports, associated incidents, and dependencies.

### Screen 3 — AI Infrastructure Intelligence

This is Cascade's signature interface.

Purpose: Explain how failures across building systems may be connected.

Use a clean interactive dependency graph.

Example:

Network Switch A → Camera 01, Camera 02, Camera 03

If all three cameras lose connectivity, Cascade identifies their shared dependency.

Visual rules:

- Nodes are simple rectangular cards.
- Connecting lines are thin and neutral.
- Selected nodes use orange highlights.
- Confirmed critical faults use red status indicators.
- Clearly distinguish suspected causes from confirmed faults.

An analysis panel should show:

- Suspected root cause
- Supporting evidence
- Confidence or uncertainty
- Affected equipment
- Recommended next step
- Create maintenance ticket action

Never present an AI hypothesis as a confirmed diagnosis without supporting evidence.

### Screen 4 — Inspector Portal

Purpose: Allow inspectors to submit equipment information.

Features:

- Upload inspection reports
- Add equipment records
- Enter inspection findings
- Record equipment condition
- Attach supporting images
- Review AI-extracted information before saving

Use a simple step-by-step form.

The system should show upload progress, extraction status, and validation errors.

### Screen 5 — Maintenance Tickets

Purpose: Turn building problems into coordinated action.

Ticket information:

- Incident ID
- Equipment
- Problem description
- Priority
- Assigned technician
- Creation timestamp
- Status
- Recommended actions
- Resolution notes

Statuses:

Open → Assigned → In Progress → Resolved

Include a chronological activity timeline.

### Screen 6 — Cascade Voice Agent

Purpose: Allow authorized staff to speak with an AI assistant about building incidents.

Interface:

- Agent availability indicator
- Call button
- Current incident context
- Conversation transcript
- Related equipment
- Recommended next steps

The agent should be powered by NVIDIA Nemotron and connected to Cascade's incident data.

The UI should distinguish between suggestions, recorded actions, and actions requiring human confirmation.

---

## 8. Navigation

Desktop sidebar:

**Overview**

- Dashboard
- Buildings

**Infrastructure**

- Equipment
- System Intelligence
- Inspections

**Operations**

- Incidents
- Maintenance
- Voice Agent

**Management**

- Reports
- Settings

Sidebar style:

- White background
- Subtle right border
- Black text
- Gray icons
- Orange active indicator
- Cascade symbol at the top

---

## 9. Landing Page

The marketing website should feel premium and minimal.

### Hero

Headline:

**Your building. Fully connected.**

Supporting text:

Cascade connects building infrastructure, inspection data, and AI-powered maintenance intelligence in one unified platform.

Primary CTA:

**Explore Cascade**

Secondary CTA:

**View Demo**

### Sections

1. Hero and product preview
2. The problem with disconnected building systems
3. Three connected infrastructure categories
4. AI-powered root-cause analysis
5. Inspector-to-technician workflow
6. Nemotron-powered voice assistance
7. Final CTA

Use product screenshots and interface previews rather than generic stock imagery.

---

## 10. Presentation Design

The Cascade pitch deck should use the same design language.

### Slide Format

16:9 widescreen.

### Colors

- White backgrounds for most slides
- Black headings
- Orange highlights
- Light gray dividers
- Occasional black section-divider slides

### Typography

- Large, bold headlines
- Short supporting statements
- Minimal body text
- One key message per slide

### Suggested Slides

1. Cascade — Title
2. The Problem
3. Our Solution
4. How Cascade Works
5. Connected Infrastructure Intelligence
6. Live Product Demo
7. Technical Architecture
8. Business Impact
9. Future Expansion
10. Closing

### Presentation Rules

- Avoid dense paragraphs.
- Use large product screenshots.
- Highlight the dependency intelligence feature.
- Show actual working functionality.
- Clearly label simulated data.
- Do not invent financial savings or performance statistics.

---

## 11. Responsive Design

### Desktop

Full sidebar, multi-column dashboards, complete tables.

### Tablet

Collapsible sidebar, reduced column count, flexible cards.

### Mobile

Single-column layouts, simplified navigation, horizontally scrollable data tables where appropriate.

Minimum touch target: 44px.

Never rely exclusively on hover interactions.

---

## 12. Accessibility

- Target WCAG 2.2 AA.
- Maintain at least 4.5:1 contrast for normal text.
- Ensure keyboard navigation works throughout.
- Provide visible focus states.
- Label all form fields.
- Include accessible chart summaries.
- Use text alongside status colors.
- Respect reduced-motion preferences.
- Ensure errors are understandable and actionable.

---

## 13. Motion and Interaction

Use subtle transitions between 150–250ms.

Appropriate animations:

- Button hover transitions
- Sidebar expansion
- Modal appearance
- Loading indicators
- Dependency graph highlighting

Avoid:

- Excessive bouncing
- Constant pulsing
- Decorative particle effects
- Large parallax animations
- Unnecessary page transitions

Animations must not distract from operational information.

---

## 14. CSS Design Tokens

```css
:root {
  --color-primary: #ff5900;
  --color-black: #111111;
  --color-white: #ffffff;

  --color-background: #fafafa;
  --color-surface: #ffffff;
  --color-surface-secondary: #f3f4f6;

  --color-border: #e5e7eb;

  --color-text: #111111;
  --color-text-secondary: #6b7280;

  --color-success: #15803d;
  --color-warning: #b45309;
  --color-critical: #dc2626;
  --color-info: #2563eb;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;

  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-6: 24px;
  --spacing-8: 32px;

  --sidebar-width: 240px;
  --header-height: 64px;

  --font-family: "Inter", Arial, sans-serif;
}
```

---

## 15. Instructions for AI Coding Agents

When generating or modifying Cascade interfaces:

1. Follow this design system consistently.
2. Use the approved Cascade logo asset.
3. Prefer simple, polished layouts over visually complex interfaces.
4. Use orange sparingly and intentionally.
5. Keep the overall interface predominantly white.
6. Use clear typography, consistent spacing, and subtle borders.
7. Build reusable components rather than duplicating styling.
8. Use realistic, clearly labeled mock data where live data is unavailable.
9. Never fabricate operational measurements or claim simulated alerts are live.
10. Prioritize dashboard readability and functional workflows.
11. Ensure responsive layouts and accessible controls.
12. Maintain consistency across every page.

**The final result should feel like a polished enterprise SaaS platform built for commercial real estate operations, not a generic AI-generated dashboard.**

---

## 16. Final Design Principle

**Cascade makes complicated building infrastructure feel simple.**

Every design decision should support clarity, reliability, and actionable intelligence.

When choosing between visual complexity and usability, prioritize usability.

When choosing between decoration and information, prioritize information.

When choosing between adding features and polishing existing workflows, prioritize a cohesive experience.
