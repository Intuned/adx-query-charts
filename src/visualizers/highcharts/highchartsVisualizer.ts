'use strict';

//#region Imports

import * as _ from 'lodash';
import * as Highcharts from 'highcharts';
import HC_exporting from 'highcharts/modules/exporting';
import HC_offlineExporting from 'highcharts/modules/offline-exporting';
import HC_Accessibility from 'highcharts/modules/accessibility';
import { ResizeSensor } from 'css-element-queries';
import { Chart } from './charts/chart';
import { IVisualizer } from '../IVisualizer';
import { IVisualizerOptions } from '../IVisualizerOptions';
import { ChartFactory } from './charts/chartFactory';
import { ChartTheme, DateFormat, IChartOptions, IColumn, DrawChartStatus } from '../../common/chartModels';
import { Changes, ChartChange } from '../../common/chartChange';
import { Utilities } from '../../common/utilities';
import { Themes } from './themes/themes';
import { HighchartsDateFormatToCommon } from './highchartsDateFormatToCommon';
import { InvalidInputError, VisualizerError } from '../../common/errors/errors';
import { ErrorCode } from '../../common/errors/errorCode';
import { ANIMATION_DURATION_MS } from './common/constants';

//#endregion Imports

type ResolveFn = (value?: void | PromiseLike<void>) => void;
type RejectFn = (ex: any) => void;

export class HighchartsVisualizer implements IVisualizer {
    private options: IVisualizerOptions;
    private highchartsChart: Highcharts.Chart;
    private basicHighchartsOptions: Highcharts.Options;
    private themeOptions: Highcharts.Options;       
    private currentChart: Chart;
    private chartContainerResizeSensor: ResizeSensor;

    public constructor() {
        // init Highcharts exporting modules
        HC_exporting(Highcharts);
        HC_offlineExporting(Highcharts);

        // init Highcharts accessibility module
        HC_Accessibility(Highcharts);
    }

    public drawNewChart(options: IVisualizerOptions): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.verifyInput(options);
                const chartOptions = options.chartOptions;

                this.options = options;
                this.currentChart = ChartFactory.create(chartOptions.chartType);
                this.currentChart.verifyInput(options);
                this.basicHighchartsOptions = this.getHighchartsOptions(options);
                this.themeOptions = Themes.getThemeOptions(chartOptions.chartTheme);
                this.onFinishDataTransformation(options, resolve, reject);
            } catch (ex) {
                reject(ex);
            }
        });
    }
           
    public updateExistingChart(options: IVisualizerOptions, changes: Changes): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.verifyInput(options);
                
                // Make sure that there is an existing chart
                const chartContainer = document.querySelector('#' + this.options.elementId);
                const isChartExist = chartContainer && chartContainer.children.length > 0;
                const isChartTypeTheOnlyChange = changes.count === 1 && changes.isPendingChange(ChartChange.ChartType);
    
                if(isChartExist && isChartTypeTheOnlyChange) {
                    const oldChart = this.currentChart;
                    const newChart = ChartFactory.create(options.chartOptions.chartType);
        
                    // We update the existing chart options only if the new chart categories and series builder method is the same as the previous chart's method
                    if(oldChart.getSplitByCategoriesAndSeries === newChart.getSplitByCategoriesAndSeries && 
                       oldChart.getStandardCategoriesAndSeries === newChart.getStandardCategoriesAndSeries) {
                        this.currentChart = newChart;
                        this.options = options;
                        
                        // Build the options that need to be updated
                        let newOptions: Highcharts.Options = this.currentChart.getChartTypeOptions();
            
                        // Apply the changes
                        this.highchartsChart.update(newOptions);
            
                        // Save the new options
                        this.basicHighchartsOptions = _.merge({}, this.basicHighchartsOptions, newOptions);
                        
                        this.onFinishDrawingChart(resolve, options);
        
                        return;
                    }
                }
    
                // Every other change - Redraw the chart
                this.drawNewChart(options)
                    .then(() => {
                        resolve();
                    })
                    .catch((ex) => {
                        reject(ex);
                    });
            } catch (ex) {
                reject(ex);
            }
        });
    }

    public changeTheme(newTheme: ChartTheme): Promise<void> {
        const options = this.options;

        return new Promise<void>((resolve, reject) => {
            // No existing chart / the theme wasn't changed - do nothing
            if(!this.currentChart || options.chartOptions.chartTheme === newTheme) {
                resolve();

                return;
            }

            // Update new theme options
            this.themeOptions = Themes.getThemeOptions(newTheme);
            
            // Re-draw the a new chart with the new theme           
            this.draw(options, resolve, reject);
        });
    }

    public downloadChartJPGImage(onError?: (error: Error) => void): void {
        if(!this.highchartsChart) {
            return; // No existing chart - do nothing
        }

        const exportingOptions: Highcharts.ExportingOptions = {
            type: 'image/jpeg',
            error: (options: Highcharts.ExportingOptions, err: Error) => {
                if(onError) {
                    onError(err);
                }
            }
        };
        
        this.highchartsChart.exportChart(exportingOptions, /*chartOptions*/ {});
    }

    //#region Private methods

    private draw(options: IVisualizerOptions, resolve: ResolveFn, reject: RejectFn): void {
        try {
            const elementId = options.elementId;
            const highchartsOptions = _.merge({}, this.basicHighchartsOptions, this.themeOptions);
    
            this.destroyExistingChart();
    
            // Draw the chart
            this.highchartsChart = Highcharts.chart(elementId, highchartsOptions, () => {
                this.handleResize();           
                this.onFinishDrawingChart(resolve, options);
            });   
        } catch(ex) {
            reject(new VisualizerError(ex.message, ErrorCode.FailedToCreateVisualization));
        }
    }

    private onFinishDrawingChart(resolve: ResolveFn, options: IVisualizerOptions): void {
        // Mark that the chart drawing was finished
        resolve();

        // If onFinishChartAnimation callback was given, call it after the anumation duration
        const finishChartAnimationCallback = options.chartOptions.onFinishChartAnimation;

        if(finishChartAnimationCallback) {
            setTimeout(() => {
                finishChartAnimationCallback(options.chartInfo);
            }, ANIMATION_DURATION_MS + 200);
        }
    }

    // Highcharts handle resize only on window resize, we need to handle resize when the chart's container size changes
    private handleResize(): void {        
        const chartContainer = document.querySelector('#' + this.options.elementId);
    
        if(this.chartContainerResizeSensor) {
            // Remove the previous resize sensor, and stop listening to resize events
            this.chartContainerResizeSensor.detach();
        }
    
        this.chartContainerResizeSensor = new ResizeSensor(chartContainer, () => {
            this.highchartsChart.reflow();
        });
    }

    private getHighchartsOptions(options: IVisualizerOptions): Highcharts.Options {
        const chartOptions = options.chartOptions;     
        const isDatetimeAxis = Utilities.isDate(chartOptions.columnsSelection.xAxis.type);

        let highchartsOptions: Highcharts.Options = {
            credits: {
                enabled: false // Hide the Highcharts watermark on the right corner of the chart
            },
            chart: {
                displayErrors: false,
                style: {
                    fontFamily: options.chartOptions.fontFamily
                }
            },
            time: {
                getTimezoneOffset: this.options.chartOptions.getUtcOffset
            },
            title: {
                text: chartOptions.title
            },
            xAxis: this.getXAxis(isDatetimeAxis, chartOptions),
            yAxis: this.getYAxis(chartOptions),        
            tooltip: {
                formatter: this.currentChart.getChartTooltipFormatter(chartOptions),
                shared: false,
                useHTML: true
            },
            legend: this.getLegendOptions(chartOptions),
            exporting: {
                buttons: {
                    contextButton: {
                        enabled: false
                    }
                },
                fallbackToExportServer: false
            }
        };

        const categoriesAndSeries = this.getCategoriesAndSeries(options);
        const chartTypeOptions = this.currentChart.getChartTypeOptions();
        
        highchartsOptions = _.merge(highchartsOptions, chartTypeOptions, categoriesAndSeries);

        return highchartsOptions;
    }
  
    private getLabelsFormatter(chartOptions: IChartOptions, column: IColumn) {
        let formatter;

        if(chartOptions.numberFormatter && Utilities.isNumeric(column.type)) {
            formatter = function() {
                const dataPoint = this;
                const value = dataPoint.value;

                // Ignore cases where the value is undefined / null / NaN etc.
                if (typeof value === 'number') {
                    return chartOptions.numberFormatter(value);
                } else {
                    return value;
                }         
            }
        } else if(chartOptions.dateFormatter && Utilities.isDate(column.type)) {
            formatter = function() {
                const dataPoint = this;
                const dateFormat = HighchartsDateFormatToCommon[dataPoint.dateTimeLabelFormat] || DateFormat.FullDate;

                return chartOptions.dateFormatter(dataPoint.value, dateFormat);
            }
        }

        return {
            formatter: formatter
        };
    }

    private getXAxis(isDatetimeAxis: boolean, chartOptions: IChartOptions): Highcharts.XAxisOptions {
        return {
            type: isDatetimeAxis ? 'datetime' : undefined,
            labels: this.getLabelsFormatter(chartOptions, chartOptions.columnsSelection.xAxis),
            title: {
                text: this.getXAxisTitle(chartOptions),
                align: 'middle'
            }
        }
    }

    private getYAxis(chartOptions: IChartOptions): Highcharts.YAxisOptions {
        const firstYAxis = this.options.chartOptions.columnsSelection.yAxes[0];
        const yAxisOptions: Highcharts.YAxisOptions = {
            title: {
                text: this.getYAxisTitle(chartOptions)
            },
            labels: this.getLabelsFormatter(chartOptions, firstYAxis)
        }

        if(chartOptions.yMinimumValue != null) {
            yAxisOptions.min = chartOptions.yMinimumValue;
        }
        
        if(chartOptions.yMaximumValue != null) {
            yAxisOptions.max = chartOptions.yMaximumValue;
        }

        return yAxisOptions;
    }

    private getYAxisTitle(chartOptions: IChartOptions): string {
        const yAxisColumns = chartOptions.columnsSelection.yAxes;
        const yAxisTitleFormatter = chartOptions.yAxisTitleFormatter;

        if(yAxisTitleFormatter) {
            return yAxisTitleFormatter(yAxisColumns);
        }

        return yAxisColumns[0].name;
    }

    private getXAxisTitle(chartOptions: IChartOptions): string {
        const xAxisColumn = chartOptions.columnsSelection.xAxis;
        const xAxisTitleFormatter = chartOptions.xAxisTitleFormatter;

        if(xAxisTitleFormatter) {
            return xAxisTitleFormatter(xAxisColumn);
        }

        return xAxisColumn.name;
    }

    private destroyExistingChart(): void {
        if(this.highchartsChart) {
            this.highchartsChart.destroy();
        }
    }

    private getCategoriesAndSeries(options: IVisualizerOptions): Highcharts.Options {
        const columnsSelection = options.chartOptions.columnsSelection; 
        let categoriesAndSeries;

        if(columnsSelection.splitBy && columnsSelection.splitBy.length > 0) {
            categoriesAndSeries = this.currentChart.getSplitByCategoriesAndSeries(options);
        } else {
            categoriesAndSeries = this.currentChart.getStandardCategoriesAndSeries(options);
        }

        return {
            xAxis: {
                categories: categoriesAndSeries.categories
            },
            series: this.currentChart.sortSeriesByName(categoriesAndSeries.series)
        }
    }

    private onFinishDataTransformation(options: IVisualizerOptions, resolve: ResolveFn, reject: RejectFn): void {
        // Calculate the number of data points
        const dataTransformationInfo = options.chartInfo.dataTransformationInfo;

        dataTransformationInfo.numberOfDataPoints = 0;

        this.basicHighchartsOptions.series.forEach((currentSeries) => {
            dataTransformationInfo.numberOfDataPoints += currentSeries['data'].length;
        });

        if(options.chartOptions.onFinishDataTransformation) {
            const drawChartPromise = options.chartOptions.onFinishDataTransformation(dataTransformationInfo);
           
            // Continue drawing the chart only after drawChartPromise is resolved with true
            drawChartPromise
                .then((continueDraw: boolean) => {
                    if(continueDraw) {
                        this.draw(options, resolve, reject);
                    } else {
                        options.chartInfo.status = DrawChartStatus.Canceled;
                        resolve(); // Resolve without drawing the chart
                    }
                });
        } else {
            // Draw the chart
            this.draw(options, resolve, reject);
        }
    }

    private verifyInput(options: IVisualizerOptions): void {
        const elementId = options.elementId;

        if(!elementId) {
            throw new InvalidInputError("The elementId option can't be empty", ErrorCode.InvalidChartContainerElementId);
        }

        
        // Make sure that there is an existing chart container element before drawing the chart
        if(!document.querySelector(`#${elementId}`)) {
            throw new InvalidInputError(`Element with the id '${elementId}' doesn't exist on the DOM`, ErrorCode.InvalidChartContainerElementId);
        }
        
        const columnSelection = options.chartOptions.columnsSelection;

        if(columnSelection.yAxes.length > 1 && columnSelection.splitBy && columnSelection.splitBy.length > 0) {
            throw new InvalidInputError("When there are multiple y-axis columns, split-by column isn't allowed", ErrorCode.InvalidColumnsSelection);
        }
    }

    private getLegendOptions(chartOptions: IChartOptions): Highcharts.LegendOptions {
        return {
            enabled: chartOptions.legendOptions.isEnabled,
            width: '100%',
            maxHeight: this.getLegendMaxHeight(),
            accessibility: {
                enabled: <any>true,
                keyboardNavigation: {
                    enabled: <any>true
                }
            }
        }
    }

    private getLegendMaxHeight(): number {
        let legendMaxHeight = 150; // Default
        const chartContainer = document.querySelector('#' + this.options.elementId);

        if(chartContainer && chartContainer.clientHeight) {
            legendMaxHeight = chartContainer.clientHeight / 5;
        }

        return legendMaxHeight;
    }

    //#endregion Private methods
}