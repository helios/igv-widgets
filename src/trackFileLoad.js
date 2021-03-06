/*
 *  The MIT License (MIT)
 *
 * Copyright (c) 2016-2017 The Regents of the University of California
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,  FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */

import { FileUtils, TrackUtils } from "../node_modules/igv-utils/src/index.js"
import FileLoad from "./fileLoad.js"
import * as Utils from './utils.js'
import AlertSingleton from './alertSingleton.js'

const indexableFormats = new Set(["vcf", "bed", "gff", "gtf", "gff3", "bedgraph"]);

class TrackFileLoad extends FileLoad {
    constructor({ localFileInput, dropboxButton, googleEnabled, googleDriveButton, loadHandler, igvxhr }) {
        super({ localFileInput, dropboxButton, googleEnabled, googleDriveButton, igvxhr });
        this.loadHandler = loadHandler;
    }

    async loadPaths(paths) {

        let configurations = [];

        // isolate JSON paths
        let jsonPaths = paths.filter(path => 'json' === FileUtils.getExtension(path) );
        if (jsonPaths.length > 0) {
            const promises = jsonPaths
                .map(path => {
                    let url = (path.google_url || path);
                    return { promise: this.igvxhr.loadJson(url) }
                });


            const jsons = await Promise.all(promises.map(task => task.promise));
            configurations.push(...jsons);

        }

        let remainingPaths = paths.filter(path => 'json' !== FileUtils.getExtension(path) );

        if (remainingPaths.length > 0) {

            // isolate data paths
            let dataPaths = TrackFileLoad.createDataPathDictionary(remainingPaths);
            if (0 === Object.keys(dataPaths).length) {
                AlertSingleton.present('ERROR: Must provide data file(s)');
                return;
            }

            // isolate index path candidates
            let indexPathCandidates = TrackFileLoad.createIndexPathCandidateDictionary(remainingPaths);

            // identify index paths that are
            // 1) present
            // 2) names of missing index paths for later error reporting
            let indexPaths = FileLoad.getIndexPaths(dataPaths, indexPathCandidates);

            TrackFileLoad.trackConfigurator(dataPaths, indexPaths, configurations);

            const str = TrackFileLoad.getErrorString(dataPaths, indexPaths, indexPathCandidates);
            if (str) {
                AlertSingleton.present(str)
            }

        }

        if (configurations.length > 0) {
            this.loadHandler(configurations);
        }


    }

    static createDataPathDictionary(paths) {

        return paths
            .filter(path => Utils.isKnownFileExtension( FileUtils.getExtension(path) ))
            .reduce((accumulator, path) => {
                accumulator[ FileUtils.getFilename(path) ] = (path.google_url || path);
                return accumulator;
            }, {});

    }

    static createIndexPathCandidateDictionary(paths) {

        return paths
            .filter(path => Utils.isValidIndexExtension( FileUtils.getExtension(path) ))
            .reduce((accumulator, path) => {
                accumulator[ FileUtils.getFilename(path) ] = (path.google_url || path);
                return accumulator;
            }, {});

    }

    static trackConfigurator(dataPaths, indexPaths, configurations) {

        for (let key of Object.keys(dataPaths)) {

            if (false === TrackFileLoad.IndexPathIsMissing(key, indexPaths)) {

                let config =
                    {
                        name: key,
                        filename:key,
                        format: TrackUtils.inferFileFormat(key),
                        url: dataPaths[ key ]
                    };

                const indexURL = FileLoad.getIndexURL(indexPaths[ key ]);

                if(indexURL) {
                    config.indexURL = indexURL
                } else {
                    if(indexableFormats.has(config.format)) {
                        config.indexed = false
                    }
                }

                TrackUtils.inferTrackTypes(config);

                configurations.push(config);
            }
        }

    }

    static jsonConfigurator(jsonConfigurations) {

        if (jsonConfigurations.length > 0) {
            let reduction;

            reduction = jsonConfigurations
                .reduce(function(accumulator, item) {

                    if (true === Array.isArray(item)) {
                        item.forEach(function (config) {
                            accumulator.push(config);
                        })
                    } else {
                        accumulator.push(item);
                    }

                    return accumulator;
                }, []);

            self.fileLoadHander(configurations);


        }
    }

    static jsonRetrievalSerial(tasks, configurations) {

        let jsonConfigurations = [];

        tasks
            .reduce((promiseChain, task) => {

                return promiseChain
                    .then((chainResults) => {

                        let { promise } = task;

                        return promise
                            .then((currentResult) => {
                                jsonConfigurations = [...chainResults, currentResult];
                                return jsonConfigurations;
                            })
                    })
            }, Promise.resolve([]))
            .then(() => {
                configurations.push(...jsonConfigurations);
                TrackFileLoad.jsonConfigurator(configurations);
            })
            .catch(error => {
                AlertSingleton.present(error.message);
            });

    }

    static IndexPathIsMissing(dataName, indexPaths) {
        let status,
            aa;

        // if index for data is not in indexPaths it has been culled
        // because it is optional AND missing
        if (undefined === indexPaths[ dataName ]) {
            status = false;
        }

        else if (indexPaths && indexPaths[ dataName ]) {

            aa = indexPaths[ dataName ][ 0 ];
            if (1 === indexPaths[ dataName ].length) {
                status = (undefined === aa);
            } else /* BAM Track with two naming conventions */ {
                let bb;
                bb = indexPaths[ dataName ][ 1 ];
                if (aa || bb) {
                    status = false
                } else {
                    status = true;
                }
            }

        } else {
            status = true;
        }

        return status;

    }

    static getErrorString(dataPaths, indexPaths, indexPathCandidates) {

        let errorStrings = [];

        for (let dataKey of Object.keys(dataPaths)) {
            if (true === TrackFileLoad.IndexPathIsMissing(dataKey, indexPaths)) {
                errorStrings.push(`Index file missing for ${ dataKey }`);
            }
        }

        let indexPathNameSet = new Set();
        for (let key in indexPaths) {
            if (indexPaths.hasOwnProperty(key)) {
                indexPaths[ key ].forEach(function (obj) {
                    if (obj) {
                        indexPathNameSet.add( obj.name );
                    }
                });
            }
        }

        for (let key of Object.keys(indexPathCandidates)) {
            if (false === indexPathNameSet.has(key)) {
                errorStrings.push(`Data file is missing for ${ name }`);
            }

        }

        return errorStrings.length > 0 ? errorStrings.join(' ') : undefined;
    }

}

export default TrackFileLoad;
