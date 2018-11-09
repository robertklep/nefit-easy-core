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

Devices related to the Nefit Easy, like the Worcester Wave, the Junkers Control, the Buderus Logamatic TC100 and the Bosch Greenstar CT100, are _probably_ also supported.

### Installation

This library requires Node.js 4.0.0 or later.

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

### Other/related projects

* [`nefit-easy-http-server`](https://github.com/robertklep/nefit-easy-http-server): an HTTP-to-XMPP bridge that allow projects that can't implement this library directly (for instance, if they aren't written in Javascript) to communicate, using an HTTP-based interface, with the Nefit Easy
* [`nefit-easy-cli`](https://github.com/robertklep/nefit-easy-cli): a command line interface tool to communicate with the Nefit Easy
* [`bosch-xmpp`](https://github.com/robertklep/bosch-xmpp): a similar library that can be used to communicate with other Bosch devices (it supports the Nefit Easy, but also IVT, Junkers Bosch, Buderus and probably any Bosch EasyRemote-compatible controller)
* [`node-red-contrib-nefit-easy2`](https://flows.nodered.org/node/node-red-contrib-nefit-easy2): a Node RED node to interact with the Nefit Easy (fork of `node-red-contrib-nefit-easy`, which doesn't work anymore and its author has abandoned the project)

### Disclaimer

The implementation of this library is based on reverse-engineering the communications between the apps and the backend, plus various other bits and pieces of information. It is _not_ based on any official information given out by Nefit/Bosch, and therefore there are no guarantees whatsoever regarding the safety of your devices and/or their settings, or the accuracy of the information provided.

## API

### General information

All (asynchronous) methods return a promise that resolves to a plain object.

`nefit-easy-core` uses [`debug`](https://github.com/visionmedia/debug) to provide some debug logging:

```
$ env DEBUG=nefit-easy-core node your-app.js
```

#### Constructor

```
const Client = require('nefit-easy-core');
const client = Client({
  serialNumber   : NEFIT_SERIAL_NUMBER,
  accessKey      : NEFIT_ACCESS_KEY,
  password       : NEFIT_PASSWORD,
[ retryTimeout   : Number ]
[ maxRetries     : Number ]
});
```

A request is retried a few times (because the backend can only handle one request at a time, requests may get dropped when more than one client is active). The default is to retry every 2000 milliseconds (`retryTimeout`) for a maximum of 15 times (`maxRetries`).

#### Reading data

`client.get(uri : String) : Promise`

This allows retrieving specific URI's from the backend.

A non-exhaustive list of URI's can be found [here](https://github.com/robertklep/nefit-easy-core/wiki/List-of-endpoints). And @marcelrv has done a great job of documenting a lot of endpoints, the results of which can be found [here](https://github.com/marcelrv/nefit_easy_protocol).

#### Writing data

`client.put(uri : String, data) : Promise`

This allows writing values to specific URI's.
