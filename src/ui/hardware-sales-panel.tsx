'use client';

import { useState } from 'react';
import type { ChipDesign, ChipFoundry, HardwareBuyerId } from '../contracts/wave4-hardware';
import { CONTENT } from '../content/catalog';
import { CHIP_FOUNDRIES, HARDWARE_BUYERS, chipProductionTerms, hardwareBuyerFit } from '../content/silicon-market';
import { formatMoney, formatUnits } from '../core/index';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

export function HardwareSalesPanel({ game, designs, canAct, onQueue }: PanelProps & { designs: ChipDesign[] }) {
  const [buyerId, setBuyer] = useState<HardwareBuyerId>('relay-edge');
  const [designId, setDesign] = useState(designs[0].id);
  const [foundry, setFoundry] = useState<ChipFoundry>('express');
  const design = designs.find(item => item.id === designId) ?? designs[0], buyer = HARDWARE_BUYERS[buyerId];
  const orders = game.slices.compute.hardwareSales ?? {}, selected = orders[buyerId];
  const terms = chipProductionTerms(design, buyer.racks, CONTENT.infrastructure.rackCU, foundry);
  const fit = hardwareBuyerFit(design, buyerId, terms);
  return <details className="inline-details">
    <summary>Accelerator sales · {Object.values(orders).length} / {Object.keys(HARDWARE_BUYERS).length} buyer orders</summary>
    <p className="small-note">Pay for production when you accept the order. The foundry ships directly to the buyer, who pays you on delivery. The order uses foundry slots, and these racks go to the buyer.</p>
    <label className="line-control wide-select" htmlFor="hardware-buyer">Buyer<select id="hardware-buyer" value={buyerId} onChange={event => setBuyer(event.target.value as HardwareBuyerId)}>
      {(Object.keys(HARDWARE_BUYERS) as HardwareBuyerId[]).map(id => <option key={id} value={id}>{HARDWARE_BUYERS[id].name}{orders[id] ? ' · order accepted' : ''}</option>)}
    </select></label>
    <p className="small-note">{buyer.racks} rack{buyer.racks === 1 ? '' : 's'} · {buyer.architecture} {buyer.target} · at least {formatUnits(buyer.minUsefulCU)} useful CU and {formatUnits(buyer.minMemoryPerCU)} MU per CU · ships within {buyer.leadWeeks} weeks.</p>
    {!selected && <>
      <label className="line-control wide-select" htmlFor="hardware-sale-design">Qualified design<select id="hardware-sale-design" value={design.id} onChange={event => setDesign(event.target.value)}>
        {designs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label className="line-control wide-select" htmlFor="hardware-sale-foundry">Foundry<select id="hardware-sale-foundry" value={foundry} onChange={event => setFoundry(event.target.value as ChipFoundry)}>
        {(Object.keys(CHIP_FOUNDRIES) as ChipFoundry[]).map(id => <option key={id} value={id}>{CHIP_FOUNDRIES[id].name}</option>)}
      </select></label>
      <Metrics>
        <Metric label="Shipment plan">{formatUnits(terms.usableCU)} CU · {terms.leadWeeks} weeks</Metric>
        <Metric label="Fabrication paid up front">{formatMoney(terms.costCents)}</Metric>
        <Metric label="Paid on delivery">{formatMoney(buyer.priceCents)}</Metric>
        <Metric label="Sale price minus production cost">{formatMoney(buyer.priceCents - terms.costCents)}</Metric>
      </Metrics>
      <ActionControl game={game} payload={fit ? null : { kind: 'accept_hardware_order', buyerId, designId: design.id, foundry }}
        label={'Accept order · ' + buyer.name} emptyReason={fit} canAct={canAct} onQueue={onQueue} />
    </>}
    {Object.values(orders).map(order => <div className="receipt-row" key={order.buyerId}>
      <strong>{HARDWARE_BUYERS[order.buyerId].name}</strong>
      <p className="small-note">{CHIP_FOUNDRIES[order.foundry].name} · {order.shippedWeek === null ? `Ships Week ${order.arrivalWeek}` : `Paid ${formatMoney(HARDWARE_BUYERS[order.buyerId].priceCents)} · Week ${order.shippedWeek}`}</p>
    </div>)}
  </details>;
}
