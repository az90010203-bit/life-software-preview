import { Component, type PropsWithChildren } from 'react';
import { pluginRegistry } from '../plugins';
import type { PluginViewProps } from './plugins';

class PluginBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div role="alert" className="plugin-fallback">
          <p>这个插件暂时无法显示，其他模块仍可使用。</p>
          <button
            className="wc-primary-action"
            onClick={() => this.setState({ failed: false })}
          >
            重试
          </button>
        </div>
      );
    return this.props.children;
  }
}

export function PluginProviders({ children }: PropsWithChildren) {
  return pluginRegistry.list.reduceRight(
    (content, plugin) => {
      const Provider = plugin.Provider;
      return <Provider key={plugin.manifest.id}>{content}</Provider>;
    },
    <>{children}</>,
  );
}

export function PluginView({
  pluginId,
  mode,
  instanceId,
}: PluginViewProps & { pluginId: string }) {
  const plugin = pluginRegistry.find(pluginId);
  return (
    <PluginBoundary key={pluginId}>
      <section
        className={
          'wc-content wc-content--' + mode + ' wc-content--' + pluginId
        }
        aria-label={
          pluginRegistry.describe(pluginId).title +
          (mode === 'panel' ? '面板' : '卡片')
        }
        data-instance-id={instanceId}
      >
        {plugin ? (
          <plugin.View mode={mode} instanceId={instanceId} />
        ) : (
          <p className="wc-empty">
            插件 {pluginId} 尚未加载，布局和数据已保留。
          </p>
        )}
      </section>
    </PluginBoundary>
  );
}

export function PluginStatuses() {
  const statuses = pluginRegistry.list.filter((plugin) => plugin.Status);
  return statuses.map((plugin, index) => {
    const Status = plugin.Status!;
    return (
      <span className="plugin-status" key={plugin.manifest.id}>
        {index > 0 && <i />}
        <PluginBoundary>
          <Status />
        </PluginBoundary>
      </span>
    );
  });
}
