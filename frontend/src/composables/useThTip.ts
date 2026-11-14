/**
 * 表头指标说明浮层（原型 .th-tip）：body 级 fixed 单例，mouseover 表头[data-tip]显示说明文字，
 * 位置=表头中心上方 8px（left 两侧钳位 8px；视口上缘 top<8 时翻到表头下方），
 * mouseout 移出表头 / 任意滚动（capture）即销毁，避免容器 overflow 裁剪与滚动漂移。
 */

let tip: HTMLDivElement | null = null;

function thTipHide(): void {
  if (tip) {
    tip.parentNode?.removeChild(tip);
    tip = null;
  }
}

document.addEventListener('mouseover', (ev) => {
  const target = ev.target as Element | null;
  const th = target && target.closest ? target.closest<HTMLElement>('th[data-tip]') : null;
  if (!th || (tip && (tip as HTMLDivElement & { _for?: Element })._for === th)) return;
  thTipHide();
  tip = document.createElement('div');
  tip.className = 'th-tip';
  tip.textContent = th.getAttribute('data-tip');
  (tip as HTMLDivElement & { _for?: Element })._for = th;
  document.body.appendChild(tip);
  const r = th.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const thh = tip.offsetHeight;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
  let top = r.top - thh - 8;
  if (top < 8) top = r.bottom + 8;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
});

document.addEventListener('mouseout', (ev) => {
  const target = ev.target as Element | null;
  const th = target && target.closest ? target.closest<HTMLElement>('th[data-tip]') : null;
  if (!th || !tip || (tip as HTMLDivElement & { _for?: Element })._for !== th) return;
  const to = ev.relatedTarget as Element | null;
  if (to && to.closest && to.closest('th[data-tip]') === th) return;
  thTipHide();
});

window.addEventListener('scroll', thTipHide, true);

export { thTipHide };
