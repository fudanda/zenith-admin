<template>
  <div class="za term">
    <div class="bar">
      <i></i><i></i><i></i>
      <span>arcbase@prod-01 — ssh</span>
      <em><b class="za-blink"></b>REC</em>
    </div>
    <div class="bd">
      <div class="ln"><span class="p">➜</span><span class="c">arcbase</span>ssh prod-01</div>
      <div class="ln d">connected · 12ms · 终端录屏中</div>
      <div class="ln"><span class="p">➜</span>docker ps</div>
      <div class="tbl">
        <span><i class="ok"></i>arcbase-server</span><span class="d">up 12d</span>
        <span><i class="ok"></i>postgres:17</span><span class="d">up 12d</span>
        <span><i class="wn"></i>redis:7</span><span class="w">restarting</span>
      </div>
      <div class="ln"><span class="p">➜</span><i class="cur za-blink"></i></div>
    </div>
  </div>
</template>

<style scoped>
/* 终端窗口撑满插画区，左上对齐的内容才不会显得悬空 */
.term {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
  color: var(--zn-dark-text);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  line-height: 1.75;
  overflow: hidden;
}

.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
}

.bar i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ff5f57;
}

.bar i:nth-child(2) { background: #febc2e; }
.bar i:nth-child(3) { background: #28c840; }

.bar span {
  flex: 1;
  margin-left: 4px;
  font-size: 10.5px;
  color: var(--zn-dark-text-2);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar em {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(255, 95, 87, 0.18);
  color: #ff7b73;
  font-size: 9.5px;
  font-style: normal;
  font-weight: 700;
  letter-spacing: 0.4px;
}

.bar em b {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.bd {
  flex: 1;
  padding: 8px 12px 10px;
  white-space: nowrap;
  overflow: hidden;
}

.ln {
  display: flex;
  align-items: center;
  gap: 6px;
}

.p { color: #34d399; }
.c { color: #93c5fd; }
.d { color: var(--zn-dark-text-2); }
.w { color: #fbbf24; }

.tbl {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 16px;
}

.tbl > span {
  display: flex;
  align-items: center;
  gap: 7px;
}

.tbl i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.ok { background: #34d399; box-shadow: 0 0 0 2.5px rgba(52, 211, 153, 0.18); }
.wn { background: #fbbf24; box-shadow: 0 0 0 2.5px rgba(251, 191, 36, 0.18); }

.cur {
  width: 7px;
  height: 13px;
  border-radius: 1px;
  background: var(--zn-dark-text);
  opacity: 0.85;
}
</style>
