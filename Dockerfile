FROM ubuntu:22.04 AS base

ARG DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

RUN apt-get update && apt-get install -y \
	expect \
	unzip \
	wget \
	xz-utils \
	default-jre \
	&& rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash bwtv
USER bwtv
WORKDIR /home/bwtv

# Tizen Studio CLI
RUN wget -nv -O web-cli_Tizen_Studio_6.1_ubuntu-64.bin 'https://download.tizen.org/sdk/Installer/tizen-studio_6.1/web-cli_Tizen_Studio_6.1_ubuntu-64.bin' \
	&& chmod a+x web-cli_Tizen_Studio_6.1_ubuntu-64.bin \
	&& ./web-cli_Tizen_Studio_6.1_ubuntu-64.bin --accept-license --no-java-check /home/bwtv/tizen-studio
ENV PATH=/home/bwtv/tizen-studio/tools/ide/bin:/home/bwtv/tizen-studio/tools:${PATH}

# Certificate and security profile used to sign the package
RUN tizen certificate -a bwtv -f bwtv -p 1234
RUN tizen security-profiles add -n bwtv -a /home/bwtv/tizen-studio-data/keystore/author/bwtv.p12 -p 1234

# Workaround to package without gnome-keyring
RUN sed -i 's|/home/bwtv/tizen-studio-data/keystore/author/bwtv.pwd||' /home/bwtv/tizen-studio-data/profile/profiles.xml
RUN sed -i 's|/home/bwtv/tizen-studio-data/tools/certificate-generator/certificates/distributor/tizen-distributor-signer.pwd|tizenpkcs12passfordsigner|' /home/bwtv/tizen-studio-data/profile/profiles.xml

# Build from the repository root
COPY --chown=bwtv src ./widget

RUN echo \
	'set timeout -1\n' \
	'spawn tizen package -t wgt -- widget\n' \
	'expect "Author password:"\n' \
	'send -- "1234\\r"\n' \
	'expect "Yes: (Y), No: (N) ?"\n' \
	'send -- "N\\r"\n' \
	'expect eof\n' \
| expect

RUN mv widget/BackWhenTV.wgt .

FROM ubuntu:22.04
RUN useradd -m -s /bin/bash bwtv
COPY --from=base --chown=bwtv /home/bwtv/BackWhenTV.wgt /home/bwtv/BackWhenTV.wgt
COPY --from=base --chown=bwtv /home/bwtv/tizen-studio /home/bwtv/tizen-studio
COPY --from=base --chown=bwtv /home/bwtv/tizen-studio-data /home/bwtv/tizen-studio-data
USER bwtv
WORKDIR /home/bwtv
ENV PATH=/home/bwtv/tizen-studio/tools/ide/bin:/home/bwtv/tizen-studio/tools:${PATH}
