# 12 — Prior Work and Evaluation Design

**Scope:** prior work on maintenance and resource scheduling (OR), dispatch-policy baselines, LLM tool-using agents and benchmarks for industrial and IT operations, and evaluation methodology carried over for testing Cascade's agent and planner. **Researched (scan date):** 2026-11-07.

Every reference below was checked against a landing page, DOI, or arXiv abstract during the scan. Items marked **[unverified]** were seen only in secondary listings.

This file was trimmed from an earlier scan built around an oilfield claim (planning repair dispatch jointly with trucking and well shut-ins). That hypothesis, its oilfield water-logistics references, and its oilfield-specific policies, metrics and scenario grid were dropped; see "Dropped" at the end. What remains is prior work and method that does not depend on that claim. Agent reliability practices specific to Nemotron are in `11-nemotron-integration.md` §5.

---

## 1. Short summary

- **The OR literature treats maintenance, operations and shared resources as one scheduling problem, but full three-way integration is rare.** The EJOR review by Geurtsen et al. (2023) covers about 250 papers on combining production, maintenance and resource scheduling. It reports that integration is common but that full three-way integration is rare.
- **The closest analogues are offshore wind O&M and power-grid maintenance.** In both, technician or vessel dispatch is optimized together with production loss or downtime cost. Papadopoulos et al. use a rolling-horizon MILP and compare it against strategies that ignore production. Schrotenboer et al. use ALNS for technician sharing. Goel & Meisel use LNS combined with mathematical programming to minimize downtime in electricity-network maintenance. The usual formulation is a deterministic MILP inside a rolling horizon, with a metaheuristic when instances get large.
- **Queueing and MDP work supplies the dispatch-rule baselines.** These papers formulate the problem as an MDP, then compare simple index or myopic policies against FCFS and static priority. Static priority rules are often near-optimal when downtime costs differ between machines (Liang et al. 2013; restless-bandit work by Glazebrook et al.). This sets a high bar: any planner must beat a smart priority rule, not only FCFS.
- **Agent benchmarks for industrial and IT operations show that current LLM agents are unreliable without deterministic scaffolding.** ITBench: about 14% of SRE scenarios solved. τ-bench: pass^8 below 25%. AssetOpsBench (IBM) is the closest benchmark to industrial asset operations; frontier models got "only about half" correct and human experts averaged 60%. MAST shows that many failures come from coordination and verification, not from the base model. The literature supports an architecture where the LLM orchestrates while solvers and simulators verify (LLM-Modulo, Kambhampati et al.).

---

## 2. Annotated references

### A. Joint maintenance / production / resource scheduling (OR)

1. **Geurtsen, M., Didden, J.B.H.C., Adan, J., Atan, Z., Adan, I. (2023). "Production, maintenance and resource scheduling: A review." *European Journal of Operational Research* 305(2), 501–529.** DOI: [10.1016/j.ejor.2022.03.045](https://doi.org/10.1016/j.ejor.2022.03.045) · [RePEc](https://ideas.repec.org/a/eee/ejores/v305y2023i2p501-529.html)
   *Relevance:* Survey of about 250 papers, through 2020. Identifies three-way integration (production plus maintenance plus shared resources) as under-studied.

2. **Papadopoulos, P., Coit, D., Ezzat, A.A. (2020/21). "Seizing Opportunity: Maintenance Optimization in Offshore Wind Farms Considering Accessibility, Production, and Crew Dispatch." arXiv:2012.00213.** [arXiv](https://arxiv.org/abs/2012.00213)
   *Relevance:* A multi-stage rolling-horizon MILP that schedules crew dispatch together with production loss. The schedule is "substantially better" than strategies that ignore those factors. A structural template for "joint vs. separate" comparisons with re-planning on each event.

3. **Schrotenboer, A.H., Uit het Broek, M.A.J., Jargalsaikhan, B., Roodbergen, K.J. (2018). "Coordinating technician allocation and maintenance routing for offshore wind farms." *Computers & Operations Research* 98, 185–197.** DOI: [10.1016/j.cor.2018.05.019](https://doi.org/10.1016/j.cor.2018.05.019)
   *Relevance:* Sharing technicians across sites reduces expected maintenance cost and helps planners handle extreme scenarios. ALNS solves it.

4. **Goel, A., Meisel, F. (2013). "Workforce routing and scheduling for electricity network maintenance with downtime minimization." *EJOR* 231(1), 210–228.** DOI: [10.1016/j.ejor.2013.05.021](https://doi.org/10.1016/j.ejor.2013.05.021)
   *Relevance:* Technician routing whose objective is asset downtime, not only travel, on an electricity network. Solved with LNS and mathematical programming on real utility data.

5. **López-Santana, E., Akhavan-Tabatabaei, R., Dieulle, L., Labadie, N., Medaglia, A.L. (2016). "On the combined maintenance and routing optimization problem." *Reliability Engineering & System Safety* 145, 199–214.** DOI: [10.1016/j.ress.2015.09.016](https://doi.org/10.1016/j.ress.2015.09.016)
   *Relevance:* Maintenance timing and technician routing for geographically distributed machines that fail randomly, solved with a two-step iterative approach. The iteration is a natural "loosely coupled" baseline between fully separate and fully joint planning.

6. **McMorland, J., Collu, M., McMillan, D., Coraddu, A. (2023). "Opportunistic maintenance for offshore wind: a review and proposal of future framework." *Renewable and Sustainable Energy Reviews* 184.** [Strathprints](https://strathprints.strath.ac.uk/86329/)
   *Relevance:* Reports that "opportunistic maintenance" has no agreed definition, and treats low-value production windows as maintenance opportunities.

### B. Dispatch / priority policies (queueing, MDP)

7. **Liang, W.K., Balcıoğlu, A.B., Svaluto, R. (2013). "Scheduling policies for a repair shop problem." *Annals of Operations Research* 211(1), 273–288.** DOI: [10.1007/s10479-013-1412-6](https://doi.org/10.1007/s10479-013-1412-6) · [Sabancı repository](https://research.sabanciuniv.edu/id/eprint/24033/)
   *Relevance:* Formulates the problem as an MDP and solves it numerically for the optimum. A dynamic Myopic(R) policy comes close to optimal and generally beats static FCFS and preemptive-resume priority. Template for a baseline ladder of FCFS, static priority, myopic, and optimal.

8. **Workforce Agility in Repair and Maintenance Environments. *Manufacturing & Service Operations Management* (2007).** DOI: [10.1287/msom.1060.0132](https://doi.org/10.1287/msom.1060.0132) **[authors not verified on the landing page]**
   *Relevance:* With heterogeneous downtime costs, static machine-priority rules perform well. This is why a cost-weighted priority rule is a mandatory baseline.

**Leads not verified, not cited above:** Huizing et al., "median routing problem for simultaneous planning of emergency response and non-emergency jobs" (EJOR 2020). Glazebrook, Mitchell & Ansell (EJOR 2005), restless-bandit index policies for maintenance.

### C. LLM agents for operations, with tool use

9. **Patel, D. et al. (IBM) (2025–26). "AssetOpsBench: Benchmarking AI Agents for Task Automation in Industrial Asset Operations and Maintenance." arXiv:2506.03828.** [arXiv](https://arxiv.org/abs/2506.03828) · [GitHub](https://github.com/IBM/AssetOpsBench) · [IBM Research blog](https://researchweb.draco.res.ibm.com/blog/asset-ops-benchmark)
   *Relevance:* The closest domain benchmark: industrial asset monitoring and maintenance scheduling, with 4 domain agents (IoT, FMSR, TSFM, work-order), 140+ queries and a simulated IoT environment. It compares Tool-As-Agent with Plan-Executor architectures and includes automated discovery of failure modes. Frontier models got "only about half" correct; human experts averaged 60%. Maximo is adding a "Condition Insights agent". Its scenario and query format, its two architectures and its six rubric dimensions are reusable for an ablation. (Landscape row in `02-competitors.md` §5b.)

10. **Jha, S. et al. (IBM/UIUC) (2025). "ITBench: Evaluating AI Agents across Diverse Real-World IT Automation Tasks." arXiv:2502.05352.** [arXiv](https://arxiv.org/abs/2502.05352)
    *Relevance:* Incident-response benchmark with 94 scenarios. State-of-the-art agents solved about 13.8% of SRE scenarios, 25.2% of CISO scenarios and 0% of FinOps scenarios. End-to-end incident handling by an LLM alone is weak, which justifies keeping decisions in deterministic tools.

11. **Yao, S., Shinn, N., Razavi, P., Narasimhan, K. (2024). "τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains." arXiv:2406.12045.** [arXiv](https://arxiv.org/abs/2406.12045)
    *Relevance:* Scores agents by comparing the final database state with a goal state, and introduces **pass^k**, the probability of succeeding on all k trials. GPT-4o's pass^8 was below 25% on retail. Use both ideas: score the final model/proposal state, and report pass^k over repeated runs.

12. **Patil, S.G. et al. (2025). "The Berkeley Function Calling Leaderboard (BFCL): From Tool Use to Agentic Evaluation of LLMs." ICML 2025, PMLR 267.** [PMLR](https://proceedings.mlr.press/v267/patil25a.html) · [Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard)
    *Relevance:* Standard method for scoring tool-call correctness: an AST match of function name and arguments, including serial and parallel calls. Use it as the scoring rule for a tool-call accuracy metric.

13. **Cemri, M. et al. (2025). "Why Do Multi-Agent LLM Systems Fail?" (MAST). arXiv:2503.13657, NeurIPS 2025 D&B.** [arXiv](https://arxiv.org/abs/2503.13657)
    *Relevance:* 14 failure modes in 3 categories: system design, inter-agent misalignment, and task verification. Many failures come from coordination and verification, not from the model itself. Use it as a checklist for labeling agent failures, such as skipped verification or premature termination.

14. **Kambhampati, S. et al. (2024). "LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks." ICML 2024 (position).** [arXiv](https://arxiv.org/abs/2402.01817)
    *Relevance:* Argues for LLMs in a loop with external sound verifiers. The theoretical justification for the design rule that numbers come from the deterministic engine, never from the model (which Cascade's README states as "the model chooses; code computes every fact and number").

15. **NVIDIA (2025). "NVIDIA Nemotron 3: Efficient and Open Intelligence." arXiv:2512.20856.** [arXiv](https://arxiv.org/abs/2512.20856) · NIM card example with BFCL v3 / ToolSandbox scores: [Nemotron-3.5-Bolt-E4B](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3_5-bolt-e4b)
    *Relevance:* Nemotron 3 models are post-trained with multi-environment RL for multi-step tool use (NeMo Gym). The abstract names no benchmarks. The Bolt-E4B NIM card lists BFCL v3 ≈ 71.3. **[Super/Ultra BFCL figures not verified]** NVIDIA also released the *Nemotron Agentic Tool Use v1* dataset **[seen only on a mirror, not verified on Hugging Face]**. Model-card benchmark figures for the current lineup are in `11-nemotron-integration.md` §2.

16. **NVIDIA agent-evaluation guidance** (Sept 2026 blog): score step-level and end-to-end, run 3–5 trials, track steps- and cost-per-success, watch for answer-key contamination. Summarized in `11-nemotron-integration.md` §5.9 (URL there).

---

## 3. Evaluation methodology that carries over

These methods were written into the earlier experiment design and do not depend on its oilfield hypothesis. How they map onto Cascade's components is **[inference]** and was not part of the original scan.

### 3.1 Baseline discipline
- Compare against both naive and strong baselines, all running in the same deterministic simulator. The earlier design used a ladder from "do nothing" and FCFS up to static cost-priority, a sequential optimum, and an iterated sequential (López-Santana-style) planner, following Liang et al. and the MDP/queueing work.
- **Baseline strength matters.** Comparing only against FCFS inflates gains. Static priority rules are often near-optimal (Liang et al. 2013; MSOM 2007), so strong rules must be reported.
- Measure the **agent's orchestration loss** separately: run the same deterministic planner with and without the LLM in the loop. The gap should be 0 when the agent calls tools correctly.

### 3.2 Agent metrics (following τ-bench, BFCL and AssetOpsBench)
- Task success: final state matches what the deterministic planner would produce (τ-bench-style state check).
- pass^k for k = 1, 3, 5 repeated runs per scenario (reliability).
- Tool-call accuracy: correct tool and correct arguments, scored by AST/argument match (BFCL-style). Also count invalid or hallucinated calls.
- Safety: actions executed without approval (must be 0), plans that bypassed feasibility validation (must be 0), and replanning after an injected tool failure.
- Failure taxonomy: label every failed trace with MAST categories.
- Cost of running the agent: number of tool calls, tokens, and wall-clock latency.
- Scale reference: run the LLM arms on a stratified subset of about 50–100 scenarios × 3 runs, similar in size to ITBench (94) and AssetOpsBench (140+).

### 3.3 Statistics and sensitivity
- Scenarios are paired: every policy runs on the same instance. Report the median and mean paired difference with a bootstrap 95% CI. Use a Wilcoxon signed-rank test for the key comparisons.
- Report the **win/tie/loss rate** against each baseline. Ties are expected when there is no resource conflict, and showing them is honest.
- One-at-a-time sensitivity sweeps around a base case, and a **tornado chart** of which parameters drive the result.
- **Robustness:** plan with nominal parameters, then simulate with sampled true values, and report how much each policy's advantage degrades.
- **Adversarial cases:** include scenarios where the intuitive rule is wrong, kept as a labeled subset rather than the headline result.

### 3.4 Threats to validity
- **Synthetic data.** Results show that a method helps in our model, not in the field. Label this clearly in the demo. (Cascade's README says the same of DFW1: accuracy on a real operator's documents is unmeasured.)
- **Baseline strength.** See §3.1.
- **Deterministic oracle.** A planner with perfect knowledge overstates real benefit; report robustness to parameter uncertainty (§3.3).
- **Small instance sizes.** Enumeration is exact only for small cases. Larger networks need a MILP or a heuristic, and any optimality gap should be reported.
- **The objective defines the winner.** A planner optimizes the cost it is scored on. Also report secondary metrics it does not optimize directly.
- **LLM variance and leakage.** Model output is stochastic, so report pass^k, not only the best run. Prompts must not contain answers, and the agent must never see the answer key. (In Cascade that is `seed/sites/dfw1/ground_truth.json`, which per the README only tests read.)
- **Selection of scenarios.** Pre-register the grid before looking at results.
- **Simulator–optimizer coupling.** If the optimizer and simulator share code, errors can cancel out. Validate the simulator independently. (Cascade's README notes the DFW1 engine and seed were written against the same design.)

---

## 4. Open questions (carried over)

1. Should repair-time or parameter uncertainty be modeled explicitly, with a two-stage stochastic version or scenario sampling?
2. What fraction of value comes from the agent itself vs. the deterministic planner? Expect the agent's value to lie in gathering data across sources and recovering from failures, not in lower cost.
3. Which Nemotron variant and endpoint? Tool-calling quality varies by size. A community report mentions multi-tool failures on an older Nano model. Run a quick check of BFCL-style accuracy on our own tool schema before the demo (see `11-nemotron-integration.md`).

## Dropped (oilfield-only)

Removed from the earlier version: the hypothesis that joint repair-and-trucking planning beats sequential planning for produced-water pump outages; produced-water and oilfield-logistics references (Yang, Grossmann & Manno 2014 shale water MILP; DOE/NETL PARETO; US Patent 9,626,729 oil-field trucking dispatch); the B0–B6/J policy table with truck and shut-in actions; operational metrics in trucking cost, lost oil revenue, barrels and overflow; the 216-cell scenario grid over trucks, technicians and overflow ratios; anchoring on the sponsor's oilfield networks; and open questions about the sponsor's oilfield data files.
