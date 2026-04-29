import React, { Suspense } from 'react';
import { Spin } from 'antd';
import type { ControlComponent } from '../types';

/** Lazy-loaded OLAP cube control. The renderer is ~10–30 KB gz of
 *  pivot/projection logic and uses AG Grid Community as the rendering
 *  surface — both already in the main vendor chunk for non-OLAP customers,
 *  so the OLAP-specific code splits off into its own chunk and is fetched
 *  only when a customer hits a cube view. Mirrors the `CdmsTree` lazy
 *  pattern in `Shell.tsx`. */
const OlapCubeRenderer = React.lazy(
  () => import('../../components/olap/OlapCubeRenderer'),
);

const OlapCubeBuiltin: ControlComponent = (props) => (
  <Suspense
    fallback={
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin />
      </div>
    }
  >
    <OlapCubeRenderer {...props} />
  </Suspense>
);

export default OlapCubeBuiltin;
