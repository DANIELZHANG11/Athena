# 继承自私有镜像源的基础镜像
FROM zukubq0aouv2k2.xuanyuan.run/opensearchproject/opensearch:2.11.1

# 声明维护者信息
LABEL maintainer="Athena DevOps"

# [重要] 安装中文分词与增强插件
# 注意：插件版本必须与 OpenSearch 版本严格一致。
# 如果构建失败，请检查插件版本号是否与 latest 镜像版本匹配。
# 这里以 2.11.1 为例，实际使用时需根据 latest 的具体版本调整 URL

# 1. 安装 IK Analysis (中文分词)
RUN /usr/share/opensearch/bin/opensearch-plugin install --batch https://get.infini.cloud/opensearch/analysis-ik/2.11.1

# 2. 安装 Pinyin Analysis (拼音搜索)
RUN /usr/share/opensearch/bin/opensearch-plugin install --batch https://get.infini.cloud/opensearch/analysis-pinyin/2.11.1

# 3. 安装 STConvert (简繁转换)
RUN /usr/share/opensearch/bin/opensearch-plugin install --batch https://get.infini.cloud/opensearch/analysis-stconvert/2.11.1
