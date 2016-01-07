# Nefit Easy™ core

Core functionality to implementation communications with Nefit/Bosch backend.

Unless you're implementing a client yourself, this library is probably not what you're looking for.

## Installation

```
$ npm i nefit-easy-core
```

### Synopsis

The Nefit Easy™ smart thermostat is sold in The Netherlands by [Nefit](http://www.welkombijnefit.nl/nl), a company owned by [Robert Bosch GmbH](http://www.bosch.com/).

The Easy can be controlled through apps for Android and iOS, which communicate with a Bosch-hosted backend using the [XMPP](https://en.wikipedia.org/wiki/XMPP) protocol. This library aims to implement the communication protocol used between the apps and the backend.

### Installation

_This library requires Node.js 4.0.0 or later!_

#### Install it as a Node module

``` javascript
$ npm install nefit-easy-core
```

#### Checkout the repository (in case you want to run the example code)

``` javascript
$ git clone https://github.com/robertklep/nefit-easy-core
$ cd nefit-easy-core
$ npm install
```

### Disclaimer

The implementation of this library is based on reverse-engineering the communications between the apps and the backend, plus various other bits and pieces of information. It is _not_ based on any official information given out by Nefit/Bosch, and therefore there are no guarantees whatsoever regarding the safety of your devices and/or their settings, or the accuracy of the information provided.

## API

### General information

All (asynchronous) methods return a ([bluebird](http://bluebirdjs.com/)) promise that resolves to a plain object.

`nefit-easy-core` uses [`debug`](https://github.com/visionmedia/debug) to provide some debug logging:

```
$ env DEBUG=nefit-easy-core node your-app.js
```

#### Constructor

```
const NefitEasyClient = require('nefit-easy-core');
const client          = NefitEasyClient({
  serialNumber   : NEFIT_SERIAL_NUMBER,
  accessKey      : NEFIT_ACCESS_KEY,
  password       : NEFIT_PASSWORD,
[ requestTimeout : Number ]
});
```

Default for `requestTimeout` is 30 seconds.

#### Reading data

`client.get(uri : String) : Promise`

This allows retrieving specific URI's from the backend.

A non-exhaustive list of URI's can be found [here](https://github.com/robertklep/nefit-easy-core/wiki/List-of-endpoints).

#### Writing data

`client.put(uri : String, data) : Promise`

This allows writing values to specific URI's.
