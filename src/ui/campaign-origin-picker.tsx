'use client';

import { useId, useState, type ReactNode } from 'react';
import { BriefcaseBusiness, Check, FlaskConical, GraduationCap, House, Upload } from 'lucide-react';
import { CAMPAIGN_ORIGINS } from '../content/campaign-origins';
import type { CampaignOrigin } from '../contracts/wave4-campaign';
import { formatMoney } from '../core/math';

const originIcons = { garage: House, university: GraduationCap, consultancy: BriefcaseBusiness };

export function CampaignOriginPicker({ replacing = false, onStart, onCancel, onLoad, status, retainsBackup = true, children }: {
  replacing?: boolean;
  onStart: (origin: CampaignOrigin) => void;
  onCancel?: () => void;
  onLoad?: () => void;
  status?: string;
  retainsBackup?: boolean;
  children?: ReactNode;
}) {
  const [origin, setOrigin] = useState<CampaignOrigin>('garage');
  const groupId = useId();
  const Heading = replacing ? 'h3' : 'h1';

  return <div className={'origin-picker' + (replacing ? ' origin-picker-compact' : '')}>
    <header className="origin-hero">
      {!replacing && <img src="/studio/garage-room-night.webp" width="1536" height="1024" className="origin-room" alt="" />}
      <div className="origin-intro">
        {!replacing && <div className="origin-brand"><FlaskConical size={21} aria-hidden="true" />Frontier Lab<span>.</span></div>}
        <Heading>{replacing ? 'Start a new lab' : 'Where does your lab begin?'}</Heading>
        <p>{replacing
          ? 'Choose an origin to replace this campaign. ' + (retainsBackup ? 'Your previous save will be available under Recovery copies.' : 'Download your current lab first to keep it.')
          : 'Choose your founding team, opening budget and first challenge.'}</p>
      </div>
    </header>
    <fieldset className="origin-grid">
      <legend className="visually-hidden">Campaign origin</legend>
      {Object.values(CAMPAIGN_ORIGINS).map(option => {
        const Icon = originIcons[option.id];
        const id = groupId + '-' + option.id;
        return <label key={option.id} className={'origin-card origin-' + option.id}>
          <input type="radio" name={groupId} value={option.id} aria-labelledby={id + '-title'} aria-describedby={[id + '-summary', id + '-assets', id + '-advantage', id + '-pressure'].join(' ')} checked={option.id === origin} onChange={() => setOrigin(option.id)} />
          <span className="origin-card-heading"><span className="origin-icon"><Icon size={23} strokeWidth={1.6} aria-hidden="true" /></span><span className="origin-check" aria-hidden="true">{option.id === origin && <Check size={13} strokeWidth={3} />}</span></span>
          <strong id={id + '-title'} className="origin-title">{option.name}</strong>
          <span id={id + '-summary'} className="origin-description">{option.description}</span>
          <span id={id + '-assets'} className="origin-resources"><strong>{formatMoney(option.cashCents)}</strong><span>{option.team}</span></span>
          <span id={id + '-advantage'} className="origin-benefit">{option.advantage}</span>
          <span id={id + '-pressure'} className="origin-pressure">{option.pressure}</span>
        </label>;
      })}
    </fieldset>
    {status && <p className="origin-system-note" role="status">{status}</p>}
    {children}
    <div className="origin-actions">
      <button type="button" className="origin-start" onClick={() => onStart(origin)}>{replacing ? 'Replace lab with ' : 'Start '}{CAMPAIGN_ORIGINS[origin].name}</button>
      {onCancel && <button type="button" onClick={onCancel}>Keep current lab</button>}
      {onLoad && <button type="button" onClick={onLoad}><Upload size={16} aria-hidden="true" />Load a save</button>}
    </div>
  </div>;
}
