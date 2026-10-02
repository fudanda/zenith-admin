import { lazy, Suspense, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { Spin } from '@douyinfe/semi-ui';
import type { IotDevice } from '@arcbase/shared/iot';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { useIotDeviceList } from '@/hooks/queries/iot-devices';

// 地图（maplibre 2MB）与设备详情抽屉（遥测图表 vchart + 拓扑 xyflow）都不是本页首屏内容：
// 各自独立 chunk，页面 chunk 只带统计卡；抽屉到首次点击标记时才挂载
const IotDeviceMap = lazy(() => import('./IotDeviceMap'));
const IotDeviceDetailDrawer = lazy(() => import('./IotDeviceDetailDrawer'));

/** 地图区域外框：定尺寸 + position: relative，lazy 地图与其兜底都铺满它，切换时不跳版 */
const MAP_FRAME_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%', height: 'calc(100vh - 280px)', minHeight: 420,
  borderRadius: 'var(--semi-border-radius-medium)',
  border: '1px solid var(--semi-color-border)',
  overflow: 'hidden',
};

/** 设备地图：有经纬度的设备散点（在线绿 / 离线灰），点击进详情 */
export default function IotMapPage() {
  const [detailDevice, setDetailDevice] = useState<IotDevice | null>(null);
  // 首次选中设备后才挂载抽屉（之后保持挂载，保留 SideSheet 关闭动画）
  const [drawerMounted, setDrawerMounted] = useState(false);

  // 位置设备清单（上限 100 台/页，取第一页；更大规模建议先按产品/分组筛选）
  const listQuery = useIotDeviceList({ page: 1, pageSize: 100 });
  const devices = useMemo(
    () => (listQuery.data?.list ?? []).filter((d) => d.latitude != null && d.longitude != null),
    [listQuery.data],
  );
  const onlineCount = devices.filter((d) => d.online).length;

  const handleSelect = useCallback((device: IotDevice) => {
    setDrawerMounted(true);
    setDetailDevice(device);
  }, []);

  return (
    <div className="page-container">
      <StatGrid style={{ marginBottom: 12 }}>
        <StatCard title="已定位设备" value={`${devices.length} 台`} />
        <StatCard title="在线" value={`${onlineCount} 台`} accent="var(--semi-color-success)" />
        <StatCard title="离线" value={`${devices.length - onlineCount} 台`} />
      </StatGrid>
      <div style={MAP_FRAME_STYLE}>
        <Suspense
          fallback={(
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin size="large" />
            </div>
          )}
        >
          <IotDeviceMap devices={devices} loading={listQuery.isLoading} onSelect={handleSelect} />
        </Suspense>
      </div>

      {drawerMounted && (
        <Suspense fallback={null}>
          <IotDeviceDetailDrawer device={detailDevice} onClose={() => setDetailDevice(null)} />
        </Suspense>
      )}
    </div>
  );
}
