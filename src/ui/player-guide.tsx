'use client';

import { ENDING_IDS, ENDING_RULES } from '../content/wave4-campaign';
import type { GameSectionVisibility, GuideLink } from './guide-links';

export function CompanyNavigation({ sections }: { sections: GameSectionVisibility }) {
  const links: GuideLink[] = [
    { href: '#business', label: 'Business' }, { href: '#people', label: 'People' },
    { href: '#data', label: 'Data' }, { href: '#lab-projects', label: 'Lab' }, { href: '#models', label: 'Models' },
    ...(sections.research ? [{ href: '#research', label: 'Research' }] : []),
    ...(sections.appliedResearch ? [{ href: '#applied-research', label: 'Applications' }] : []),
    { href: '#compute', label: 'Compute' },
    ...(sections.capacityForecast ? [{ href: '#compute-costs', label: 'Costs' }, { href: '#capacity-forecast', label: 'Forecast' }] : []),
    { href: '#product', label: 'Chat' }, { href: '#customer-briefs', label: 'Customer briefs' },
    ...(sections.developerApi ? [{ href: '#developer-api', label: 'API' }] : []),
    ...(sections.businessCommitments ? [{ href: '#business-commitments', label: 'Contracts' }] : []),
    ...(sections.agents ? [{ href: '#agents', label: 'Agents' }] : []),
    ...(sections.infrastructure ? [{ href: '#infrastructure', label: 'Infrastructure' }] : []),
    ...(sections.chips ? [{ href: '#chips', label: 'Chips' }] : []),
    { href: '#campus', label: 'Campus' },
    ...(sections.market ? [{ href: '#market', label: 'Market' }] : []),
    ...(sections.campaign ? [{ href: '#campaign', label: 'Ambitions' }] : []),
    { href: '#company-log', label: 'Log' }, { href: '#save', label: 'Save' },
  ];
  return <nav className="company-navigation" aria-label="Company sections"><span>Jump to</span><ul>{links.map(link => <li key={link.href}><a href={link.href}>{link.label}</a></li>)}</ul></nav>;
}

export function PlayerGuide({ sections }: { sections: GameSectionVisibility }) {
  return <details className="play-guide" id="play-guide"><summary>How to run your lab</summary>
    <div className="guide-columns">
      <section aria-label="From data to first sale"><h3>From data to first sale</h3>
        <ol className="guide-steps">
          <li><strong>Prepare your data.</strong> In <a href="#data">Data</a>, prepare a dataset using Data points. The founder starts work when the project begins. See who else can help under <a href="#people">People</a>.</li>
          <li><strong>Train a version.</strong> In the <a href="#lab-projects">training bench</a>, choose a starting model, a focus, and prepared data. Compare the projected scores, then start the run. Your team supplies the Design points automatically.</li>
          <li><strong>Test and improve.</strong> Open the finished version in <a href="#models">Models</a> to see which skills changed. Run an evaluation to check it for release, or choose <strong>Continue training this model</strong> to build a new version from it.</li>
          <li><strong>Deploy and serve.</strong> Launch an eligible model under <a href="#product">Basic Chat</a>. Keep serving compute available for trials; converted accounts begin paying in a later week.</li>
        </ol>
        <p className="small-note">Start paused. Queue data preparation and step two weeks. Then queue Conversation adaptation. The founder switches to Design as training begins. Check the milestone above after each step. Weekly rent and payroll start as soon as time advances.</p>
        <p className="small-note">Choose <strong>Design your own</strong> in the training bench to set model size, sparsity, a seven-skill data mix and a compute budget. Adaptation keeps your starting model’s architecture; a new foundation lets you change it. The forecast calculates expected skills from your choices and prepared data. The bench defaults to this designer after your first model finishes; <strong>Training methods</strong> keeps the guided and specialist options.</p>
        <p className="small-note">To develop <strong>Reasoning, Long context, or Multimodal</strong> skills, acquire and prepare matching examples in Data and give those skills a share of the custom training mix. Run <strong>Reasoning, context &amp; multimodal</strong> in Models to measure 20 held-out cases per skill. That test measures advanced skills; keep using a capability test to qualify a release.</p>
      </section>
      <section aria-label="Staff and compute guide"><h3>Match work to resources</h3>
        <dl className="guide-definitions"><div><dt>Work points</dt><dd>Each ready employee generates points every week. A newly onboarded researcher produces 30 Research, 10 Design, and 5 Data points. Each week, active projects take the points they can use. Design points supervise training while GPUs perform the compute work. Unused points expire that week.</dd></div><div><dt>Experience</dt><dd>Employees earn experience when a project uses their points. At Senior rank, open <a href="#people">Team output</a> to choose a specialty. Their new mix of points goes straight into weekly work.</dd></div><div><dt>Founder</dt><dd>The founder contributes up to 20 points across active jobs each week, filling gaps in the team. Hardware work requires a specialist. New hires start contributing after onboarding.</dd></div><div><dt>CU</dt><dd>Compute units: how much GPU capacity you have. Split it between serving customers, development, and research in <a href="#compute">Compute</a>.</dd></div><div><dt>CUw</dt><dd>Compute-unit weeks: the amount of compute work a job needs. Hardware speed affects how quickly it finishes. Both compute and staff work must be complete.</dd></div><div><dt>MU</dt><dd>Memory units: space for models, customer conversations, and active jobs. Each job must fit within one compatible group of connected hardware.</dd></div></dl>
        <p className="small-note">Cloud rent is paid even when idle. Owned hardware has upkeep, operating staff, and a separate charge for actual GPU work. Review the <a href="#business">ledger and base costs</a> before expanding.</p>
        {sections.capacityForecast && <p className="small-note">Install the <a href="#capacity-forecast">capacity forecast</a> to see whether today’s hardware and staff can handle twelve weeks of customer growth and contracts. The forecast is a preview; confirm any rentals, compute changes, or hires separately.</p>}
        {sections.capacityForecast && <p className="small-note">Install <a href="#compute-costs">cost accounting</a> to see weekly GPU bills and each product’s contribution: revenue minus its compute cost. You still need to cover unused cloud rentals, shared site costs, salaries, and other expenses.</p>}
        {sections.infrastructure && <p className="small-note">After Enterprise operations, <a href="#infrastructure">extend a site’s power and cooling</a> independently or relocate installed racks. Transport takes equipment offline while both locations reserve a slot. Hardware yield and purchase history stay with the rack; fast fabric stays at the site.</p>}
      </section>
      <section aria-label="Research and deployment guide"><h3>Put your research to work</h3>
        <p className="small-note"><a href="#customer-briefs">Customer briefs</a> give you a client, a deadline, and a delivery fee. Check the success conditions before accepting. The consultancy begins with its first pilot already signed.</p>
        <p className="small-note">Research unlocks new options. To use them, you still need to train a model, build an upgrade, or install hardware. Your live products keep their current setup until you change it.</p>
        {sections.research && <p className="small-note">After Evaluation suite, fund <strong>Architecture research</strong>. Level 1 unlocks Edge models and level 3 unlocks Frontier models. You can keep funding iterations afterward to raise future custom designs’ potential, with diminishing returns and increasing costs. Complete the Research points and compute work, then advance one more week. Research is saved with each new training plan and does not raise the scores of models you already own.</p>}
        <p className="small-note">Choose data that contains examples of the skill you want to improve. A documents dataset can help a conversation model learn document work. Check the forecast for skills that might decline. Each completed run saves a separate version. A live product keeps serving its current version until you switch it.</p>
        {sections.appliedResearch && <p className="small-note">After Enterprise operations, open Release operations in a live product. Rehearse the switch from its current model to the new one, pay for release preparation, then choose when to switch. The current model keeps serving while you prepare. You have six weeks to pay for one rollback if needed. A prepared release still needs enough capacity when it launches.</p>}
        {sections.research && <p className="small-note">After Preference tuning, open Customer feedback in Basic Chat or Developer API. Study four weeks of paid use from customers who agree to take part, then pay for data staff and GPU review. Use the new dataset in the Lab. Study failures to improve behavior, or choose a representative sample for broader coverage. Train and test a new model before releasing it.</p>}
        {sections.research && <p className="small-note">To improve refusals, buy and prepare Policy contrast pairs in Data. Preference tuning and Behavior cases unlock two training recipes: boundary discrimination reduces needless refusals; conservative refusal makes the model more cautious. Test its capabilities, then run Policy boundary holdouts on that model. Commercial use requires no more than 5 rule-breaking answers in 50 restricted cases. Rehearse the release to compare useful answers and serving costs.</p>}
        {sections.appliedResearch && <p className="small-note">Deduplication removes repeated examples from a dataset for future training. Document evidence checks withhold answers that lack source support, but need extra serving work and data upkeep. Withheld answers can affect customer retention. These tools do not retrain saved models.</p>}
        {sections.appliedResearch && <p className="small-note">Adapters based on the same model can share its memory in one serving pool. Each request still uses compute. Budgeted planner training reduces repeated lookups. Independent outcome holdouts check whether an agent’s claims match its results and whether its checker makes mistakes. You still need the normal capability tests before release.</p>}
        {sections.agents && <p className="small-note">Install action receipts to resume paused workflows or jobs that ran out of budget. Pay to continue the same job with its original tools, information, and completed work. Its total limits remain 24 steps and 32 CUw. Completed invoices stay closed.</p>}
        {sections.research && <p className="guide-actions"><a href="#research">Review research and applications</a></p>}
        {sections.appliedResearch && <p className="guide-actions"><a href="#applied-research">Apply discovered methods</a></p>}
      </section>
      <section aria-label="Campaign direction guide"><h3>Build toward a company ambition</h3>
        <ul className="guide-routes">{ENDING_IDS.map(id => <li key={id}><strong>{ENDING_RULES[id].name}</strong><span>{ENDING_RULES[id].description}</span></li>)}</ul>
        <p className="small-note">Meet every requirement for enough weeks in a row to earn an ending. You can keep playing afterward.</p>
        {sections.campaign ? <p className="guide-actions"><a href="#campaign">See goals and progress</a></p> : <p className="small-note">The Company ambitions panel opens after your first paid revenue.</p>}
      </section>
    </div>
    <p className="guide-timing"><strong>One shared clock.</strong> Queued choices take effect at the start of next week. Finished projects may need one more week before you can use them. Pause to plan, or step forward one week to see the result. The game pauses when its tab is hidden and does not progress offline. <a href="#save">Download a save</a> to back up your lab or move it to another browser. Supported earlier saves upgrade when loaded and retain earned progress; their models develop the new skills through future training.</p>
  </details>;
}
